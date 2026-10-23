import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as t from '../db/schema.js';
import { LOCK_USER_PROVISIONING } from './locks.js';
import type { AuthStore, LoginOutcome, OidcIdentity } from './types.js';

type Db = NodePgDatabase;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Az Általános színtér alapadatai, ha a rendszerindítás hozza létre (a seed első színterével egyező). */
const GENERAL_SPACE = {
  name: 'Általános',
  description: 'Közös tudás, minden felhasználónak',
  color: '#3B6FB6',
} as const;

export interface PgAuthStoreOptions {
  /** A rendszerindítást egyedül végezheti e-mail (D54); a konfigból jön, kisbetűsítve is összehasonlított. */
  bootstrapAdminEmail: string;
}

/** A hitelesítés PostgreSQL-megvalósítása (a `taltos_app` szerepkörrel; DELETE nincs, a visszavonás UPDATE). */
export function createPgAuthStore(db: Db, options: PgAuthStoreOptions): AuthStore {
  const bootstrapEmail = options.bootstrapAdminEmail.toLowerCase();
  return {
    async createSession({ id, userId, now, expiresAt }) {
      await db
        .insert(t.sessions)
        .values({ id, userId, createdAt: now, lastSeenAt: now, expiresAt });
    },

    // Elsődleges kulcs szerinti keresés; az allowlist-állapotot ugyanaz a lekérdezés adja (PK-keresés az allowlisten).
    async findSession(id) {
      const [row] = await db
        .select({
          userId: t.sessions.userId,
          lastSeenAt: t.sessions.lastSeenAt,
          expiresAt: t.sessions.expiresAt,
          systemRole: t.users.systemRole,
          displayName: t.users.displayName,
          email: t.users.email,
          avatarUrl: t.users.avatarUrl,
          onAllowlist: sql<boolean>`EXISTS (
            SELECT 1 FROM ${t.allowlist}
             WHERE ${t.allowlist.email} = lower(${t.users.email}) AND ${t.allowlist.deletedAt} IS NULL)`,
        })
        .from(t.sessions)
        .innerJoin(t.users, eq(t.users.id, t.sessions.userId))
        .where(eq(t.sessions.id, id))
        .limit(1);
      return row;
    },

    async touchSession(id, now, staleBefore) {
      await db
        .update(t.sessions)
        .set({ lastSeenAt: now })
        .where(and(eq(t.sessions.id, id), lt(t.sessions.lastSeenAt, staleBefore)));
    },

    async revokeSession(id, now) {
      await db
        .update(t.sessions)
        .set({ expiresAt: sql`least(${t.sessions.expiresAt}, ${now}::timestamptz)` })
        .where(eq(t.sessions.id, id));
    },

    login: (identity, now) => db.transaction((tx) => login(tx, identity, now, bootstrapEmail)),

    async spacesOf(userId) {
      return db
        .select({
          id: t.spaces.id,
          name: t.spaces.name,
          type: t.spaces.type,
          role: t.spaceMembers.role,
        })
        .from(t.spaceMembers)
        .innerJoin(t.spaces, eq(t.spaces.id, t.spaceMembers.spaceId))
        .where(
          and(
            eq(t.spaceMembers.userId, userId),
            isNull(t.spaceMembers.removedAt),
            isNull(t.spaces.deletedAt),
          ),
        )
        .orderBy(asc(sql`${t.spaces.type} <> 'general'`), asc(t.spaces.name));
    },
  };
}

type UserMatch =
  { kind: 'found'; id: string; pseudonymized: boolean } | { kind: 'conflict' } | { kind: 'none' };

async function findUser(tx: Tx, identity: OidcIdentity): Promise<UserMatch> {
  const [bySub] = await tx
    .select({ id: t.users.id, pseudonymizedAt: t.users.pseudonymizedAt })
    .from(t.users)
    .where(eq(t.users.oidcSub, identity.sub))
    .limit(1);
  if (bySub) return { kind: 'found', id: bySub.id, pseudonymized: bySub.pseudonymizedAt !== null };

  const [byEmail] = await tx
    .select({ id: t.users.id, oidcSub: t.users.oidcSub })
    .from(t.users)
    .where(eq(sql`lower(${t.users.email})`, identity.email))
    .limit(1);
  if (!byEmail) return { kind: 'none' };
  // Előre létrehozott (még azonosító nélküli) sort átvehetünk; másik azonosítóhoz kötöttet nem.
  return byEmail.oidcSub === null
    ? { kind: 'found', id: byEmail.id, pseudonymized: false }
    : { kind: 'conflict' };
}

async function refreshUser(
  tx: Tx,
  userId: string,
  identity: OidcIdentity,
  now: Date,
): Promise<void> {
  await tx
    .update(t.users)
    .set({
      oidcSub: identity.sub,
      email: identity.email,
      displayName: displayNameOf(identity),
      avatarUrl: identity.picture,
      lastLoginAt: now,
    })
    .where(eq(t.users.id, userId));
}

function displayNameOf(identity: OidcIdentity): string {
  return identity.name ?? identity.email.split('@')[0] ?? identity.email;
}

async function adminExists(tx: Tx): Promise<boolean> {
  const [admin] = await tx
    .select({ id: t.users.id })
    .from(t.users)
    .where(eq(t.users.systemRole, 'system_admin'))
    .limit(1);
  return admin !== undefined;
}

async function login(
  tx: Tx,
  identity: OidcIdentity,
  now: Date,
  bootstrapEmail: string,
): Promise<LoginOutcome> {
  // 1. Kapu: aktív allowlist-bejegyzés (D5). Az e-mail kisbetűs, mint a tárolt kulcs.
  const [allowed] = await tx
    .select({ email: t.allowlist.email })
    .from(t.allowlist)
    .where(and(eq(t.allowlist.email, identity.email), isNull(t.allowlist.deletedAt)))
    .limit(1);
  if (!allowed) return { status: 'not_on_allowlist' };

  // 2. D54: amíg nincs Rendszeradmin, csak a bootstrap e-mail léphet be (az Általánosnak még nincs gazdája).
  const isBootstrapEmail = identity.email === bootstrapEmail;
  if (!isBootstrapEmail && !(await adminExists(tx))) return { status: 'setup_pending' };

  // 3. Meglévő felhasználó: a gyors út, zárolás nélkül.
  const existing = await findUser(tx, identity);
  if (existing.kind === 'conflict') return { status: 'identity_conflict' };
  if (existing.kind === 'found') return settle(tx, existing, identity, now);

  // 4. Új felhasználó: a létrehozás és a rendszerindítás-döntés sorosított (D52). A zár a tranzakció végéig
  // tart, és a zár megszerzése UTÁN újra olvasunk (READ COMMITTED: a várakozás alatt commitolt sor látszik).
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_USER_PROVISIONING}::bigint)`);
  const again = await findUser(tx, identity);
  if (again.kind === 'conflict') return { status: 'identity_conflict' };
  if (again.kind === 'found') return settle(tx, again, identity, now);

  // A zár alatt újraellenőrizve: közben egy másik belépő rendszert indíthatott.
  const bootstrap = !(await adminExists(tx));
  if (bootstrap && !isBootstrapEmail) return { status: 'setup_pending' };

  const [created] = await tx
    .insert(t.users)
    .values({
      oidcSub: identity.sub,
      email: identity.email,
      displayName: displayNameOf(identity),
      avatarUrl: identity.picture,
      systemRole: bootstrap ? 'system_admin' : 'user',
      createdAt: now,
      lastLoginAt: now,
    })
    .returning({ id: t.users.id });
  if (!created) throw new Error('A felhasználó létrehozása nem adott vissza sort.');
  const userId = created.id;

  const [general] = await tx
    .select({ id: t.spaces.id })
    .from(t.spaces)
    .where(eq(t.spaces.type, 'general'))
    .limit(1);

  if (bootstrap) {
    // D52: egyetlen aktor nélküli esemény; külön space_created / system_admin_granted nem íródik.
    let spaceId = general?.id;
    if (spaceId === undefined) {
      const [space] = await tx
        .insert(t.spaces)
        .values({ ...GENERAL_SPACE, type: 'general', createdBy: userId, createdAt: now })
        .returning({ id: t.spaces.id });
      if (!space) throw new Error('Az Általános színtér létrehozása nem adott vissza sort.');
      spaceId = space.id;
    }
    await tx.insert(t.spaceMembers).values({
      spaceId,
      userId,
      role: 'space_manager',
      addedBy: userId,
      createdAt: now,
    });
    await tx.insert(t.events).values({
      type: 'system_bootstrapped',
      spaceId,
      actorId: null,
      details: { userId, spaceId, spaceCreated: general === undefined },
      createdAt: now,
    });
  } else {
    if (!general) {
      // Van Rendszeradmin, de nincs Általános: nem a belépő dolga javítani (D43); a tranzakció visszagördül.
      throw new Error('Az Általános színtér hiányzik, az új felhasználó nem vehető fel.');
    }
    await tx.insert(t.spaceMembers).values({
      spaceId: general.id,
      userId,
      role: 'author',
      addedBy: userId,
      createdAt: now,
    });
    await tx.insert(t.events).values({
      type: 'member_added',
      spaceId: general.id,
      actorId: userId,
      details: { userId, role: 'author', source: 'first_login' },
      createdAt: now,
    });
  }
  return { status: 'ok', userId };
}

async function settle(
  tx: Tx,
  match: Extract<UserMatch, { kind: 'found' }>,
  identity: OidcIdentity,
  now: Date,
): Promise<LoginOutcome> {
  // Pszeudonimizált (eltávolított) felhasználó nem léphet be újra: a sor személyes adatai törölve vannak (D48).
  if (match.pseudonymized) return { status: 'identity_conflict' };
  await refreshUser(tx, match.id, identity, now);
  return { status: 'ok', userId: match.id };
}
