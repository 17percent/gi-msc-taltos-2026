import { makeRng, type Rng } from './prng.js';

/**
 * A fejlesztői dummy korpusz TERVE (D11, H5 WP1): tiszta függvény, adatbázis nélkül. A `seed.ts` hajtja végre
 * a `ReviewService` lépéseinek megfelelő tranzakciókban; a `seed-data.test.ts` ellenőrzi a terv belső konzisztenciáját.
 * Determinisztikus: ugyanaz a seed ugyanazt a tervet adja (azonosítók, időpontok, szövegek).
 * Csak kitalált nevek és a fenntartott `example.test` tartomány (RFC 2606) címei szerepelnek benne, így semmilyen levél nem érhet el valódi címzettet; éles adat sosem kerül ide.
 */

/** A korpusz időkezdete (rögzített, hogy a seed ne függjön az óra állásától). */
export const SEED_BASE = new Date('2026-08-03T08:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

export type SpaceType = 'general' | 'team' | 'project';
export type SpaceRole = 'author' | 'space_manager';
export type ChangeKind = 'create' | 'update' | 'metadata' | 'restore' | 'delete' | 'unarchive';
export type Outcome = 'approved' | 'rejected' | 'withdrawn' | 'pending';
export type ReviewState = 'draft' | 'pending' | 'changes_requested' | 'approved';
export type LinkType = 'hivatkozik' | 'szarmazik' | 'epit_ra' | 'helyettesiti';

export interface SeedUser {
  id: string;
  email: string;
  displayName: string;
  systemRole: 'user' | 'system_admin';
  createdAt: Date;
}
export interface SeedSpace {
  id: string;
  name: string;
  type: SpaceType;
  description: string;
  color: string;
  createdBy: string;
  createdAt: Date;
  members: { userId: string; role: SpaceRole }[];
  /** Később eltávolított tagok (soft delete: `removed_at`); a `members` listában továbbra is szerepelnek. */
  removed: { userId: string; at: Date }[];
}
export interface SeedKind {
  key: string;
  label: string;
  sortOrder: number;
}
export interface SeedTag {
  id: string;
  name: string;
  normalizedName: string;
  createdBy: string;
  createdAt: Date;
}
export interface SeedLink {
  toId: string;
  type: LinkType;
  anchorText: string | null;
}
export interface SeedRevision {
  id: string;
  title: string;
  content: string;
  metadata: {
    kind: string;
    tagIds: string[];
    links: { toId: string; type: LinkType; anchor: string | null }[];
  };
  authorId: string;
  contributors: string[];
  message: string | null;
  createdAt: Date;
}
export interface SeedChange {
  id: string;
  kind: ChangeKind;
  baseRevisionId: string | null;
  proposedRevisionId: string | null;
  initiatorId: string;
  reviewers: [string, string];
  message: string | null;
  proposedReviewDueAt: Date | null;
  createdAt: Date;
  outcome: Outcome;
  /** Lezárás ideje (pending kérésnél null). */
  decidedAt: Date | null;
  /** Jóváhagyáskor a dokumentum új iteration-je. */
  iteration: number | null;
  /** Elutasításnál: ki és miért. */
  rejection: { reviewerId: string; reason: string } | null;
}

/** A dokumentum élettörténetének lépései: a végrehajtó ugyanezt a sorrendet követi, lépésenként egy tranzakcióban. */
export type Step =
  | { t: 'checkpoint'; revision: SeedRevision }
  | {
      t: 'submit';
      change: SeedChange;
      revision: SeedRevision | null;
      liveTitle: string;
      liveContent: string;
      addTagId: string | null;
    }
  | { t: 'vacate'; changeId: string; reviewerId: string; at: Date }
  | { t: 'resolve'; change: SeedChange }
  | { t: 'edit_start'; at: Date; liveContent: string }
  | { t: 'discard'; at: Date };

export interface SeedDoc {
  id: string;
  spaceId: string;
  slug: string;
  title: string;
  kind: string;
  ownerId: string;
  createdAt: Date;
  initialContent: string;
  tagIds: string[];
  links: SeedLink[];
  steps: Step[];
  /** A végállapot (a terv szerint): ellenőrzéshez. */
  finalState: ReviewState;
  archived: boolean;
  discarded: boolean;
  /** Az `iteration` végértéke. */
  iteration: number;
  reviewDueAt: Date | null;
  duplicatedFromId: string | null;
  /** Rendszer-esemény a közelgő esedékességről (actor NULL). */
  dueSoonEventAt: Date | null;
}
export interface SeedComment {
  id: string;
  documentId: string;
  authorId: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}
export interface SeedPlan {
  seed: number;
  users: SeedUser[];
  spaces: SeedSpace[];
  kinds: SeedKind[];
  tags: SeedTag[];
  docs: SeedDoc[];
  comments: SeedComment[];
  favorites: { userId: string; documentId: string; createdAt: Date }[];
  subscriptions: { userId: string; documentId: string; createdAt: Date }[];
}

// ── korpusz-szöveg ───────────────────────────────────────────────────────────

const USERS: { name: string; local: string }[] = [
  { name: 'Tóth Máté', local: 'mate.toth' },
  { name: 'Kiss Anna', local: 'anna.kiss' },
  { name: 'Nagy Béla', local: 'bela.nagy' },
  { name: 'Varga Eszter', local: 'eszter.varga' },
  { name: 'Horváth Gábor', local: 'gabor.horvath' },
  { name: 'Szabó Júlia', local: 'julia.szabo' },
  { name: 'Molnár Péter', local: 'peter.molnar' },
  { name: 'Fekete Réka', local: 'reka.fekete' },
  { name: 'Balogh Tamás', local: 'tamas.balogh' },
  { name: 'Papp Dóra', local: 'dora.papp' },
  { name: 'Lakatos Zoltán', local: 'zoltan.lakatos' },
  { name: 'Simon Kinga', local: 'kinga.simon' },
];

/** A prototípus kilenc régi kategóriája: ezek lesznek a fajták (V33). */
const KINDS: { key: string; label: string; titles: string[] }[] = [
  {
    key: 'prompt',
    label: 'Promptok',
    titles: [
      'Ügyfél-email megválaszolása - alap prompt',
      'Jegyzőkönyv-összefoglaló prompt',
      'Kódreview prompt - biztonsági fókusz',
      'Hibajelentés-osztályozó prompt',
      'SQL-lekérdezés generálása leírásból',
      'Adatkinyerés számlából - strukturált JSON',
    ],
  },
  {
    key: 'skill',
    label: 'Skillek',
    titles: [
      'Számla-feldolgozó skill',
      'Ügyfélszolgálati válaszgenerátor skill',
      'Dokumentum-kivonatoló skill',
      'Naptár-egyeztető skill',
      'Jelentéskészítő skill',
      'Szerződés-kivonatoló skill',
    ],
  },
  {
    key: 'guide',
    label: 'Guide-ok',
    titles: [
      'Első lépések az asszisztenssel',
      'Hogyan írj jó promptot',
      'Modellválasztás: mikor melyiket?',
      'Eszközhívás (tool use) alapjai',
      'Költségkövetés és tokenszámlálás',
      'Strukturált kimenet kérése',
    ],
  },
  {
    key: 'template',
    label: 'Sablonok',
    titles: [
      'Prompt-sablon - feladatleírás váz',
      'Skill-leírás sablon',
      'Rendszerutasítás sablon',
      'Kiértékelési terv sablon',
      'Modellváltás - átállási sablon',
      'Prompt-változásnapló sablon',
    ],
  },
  {
    key: 'best_practice',
    label: 'Best practice-ek',
    titles: [
      'Prompt-verziózás és -mérés',
      'Érzékeny adat kezelése modellhívásnál',
      'Emberi jóváhagyás - hol kötelező?',
      'Kimenetellenőrzés automatizálása',
      'Prompt-injekció elleni védekezés',
      'Költséghatékony modellhasználat',
    ],
  },
  {
    key: 'system_prompt',
    label: 'Rendszerutasítások',
    titles: [
      'Alap rendszerutasítás - belső asszisztens',
      'Ügyfélkapcsolati asszisztens rendszerutasítása',
      'Fejlesztői asszisztens rendszerutasítása',
      'Hangnem és stílus - közös szabályblokk',
      'Adatkezelési korlátok - kötelező blokk',
      'Eszkalációs szabályok az asszisztensben',
    ],
  },
  {
    key: 'agent',
    label: 'Agent-definíciók',
    titles: [
      'Jóváhagyási folyamat-agent',
      'Riport-összeállító agent',
      'Beszerzési asszisztens agent',
    ],
  },
  {
    key: 'eval_set',
    label: 'Kiértékelő készletek',
    titles: [
      'Ügyfélválasz-kiértékelő készlet',
      'Összefoglaló-minőség mérése',
      'Regressziós készlet promptváltáshoz',
    ],
  },
  // Szándékosan dokumentum nélküli fajta (a facet-lista üres elemére), mint a prototípusban.
  { key: 'mcp_server', label: 'MCP-szerverek', titles: [] },
];

const TAGS = [
  'ügyfélszolgálat',
  'biztonság',
  'sql',
  'riport',
  'fordítás',
  'jegyzőkönyv',
  'számla',
  'onboarding',
  'kódreview',
  'adatkinyerés',
  'kiértékelés',
  'költség',
  'szerződés',
  'e-mail',
  'naptár',
  'hibajelentés',
  'adatbázis',
  'hangnem',
];

const SECTIONS = ['Cél', 'Használat', 'Változók és bemenet', 'Példák', 'Ismert korlátok'];
const LINES = [
  'A leírás egyetlen feladatra szól; összetett kérést bontsd lépésekre.',
  'A kimenet formátumát az utolsó bekezdés köti meg, mérés nélkül ne írd át.',
  'Két-három példa érdemben javít a minőségen, ennél több ritkán segít.',
  'Éles ügyféladat nem kerül kísérleti kérésbe.',
  'Írási művelet előtt megerősítést kér a felhasználótól.',
  'A hibát nem nyeljük el, hanem jelezzük a hívónak.',
  'A változásokat review után vezetjük át a Jóváhagyott változatba.',
];
const COMMENT_TEXTS = [
  'Köszönöm, ezt használtuk a múlt heti riportnál is.',
  'A második szakasz példája frissítésre szorul.',
  'Kipróbáltam, a kimenet stabil maradt.',
  'Érdemes lenne ide egy ellenpéldát is írni.',
  'Ugyanez a szabály az ügyfélszolgálati asszisztensre is vonatkozik?',
  'Lezárom a kérdést: a jelenlegi leírás elég.',
];
const COLORS = ['#3B6FB6', '#2E8B6F', '#B5651D', '#8A4F9E', '#B23A48'];

function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}
export function slugify(text: string): string {
  return (
    foldAccents(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'dokumentum'
  );
}
/** A címke normalizált neve: kisbetű, ékezet nélkül, szóköz-normalizált (B4 `tags.normalized_name`). */
export function normalizeTag(name: string): string {
  return foldAccents(name).toLowerCase().replace(/\s+/g, ' ').trim();
}

function makeContent(rng: Rng, title: string, version: number): string {
  const sections = SECTIONS.slice(0, rng.between(3, 5));
  const body = sections.map((s) => `## ${s}\n\n${rng.pick(LINES)} ${rng.pick(LINES)}\n`).join('\n');
  return `# ${title}\n\n${body}\n<!-- változat: ${version} -->\n`;
}

// ── a dokumentum-forgatókönyvek ──────────────────────────────────────────────

type PlanName =
  | 'approvedOnce'
  | 'approvedMany'
  | 'pendingNew'
  | 'pendingUpdate'
  | 'pendingVacated'
  | 'rejectedNew'
  | 'rejectedUpdate'
  | 'draftOnly'
  | 'draftAfterApproved'
  | 'withdrawn'
  | 'archived'
  | 'unarchived'
  | 'discarded';

/** Súlyozott forgatókönyv-lista: minden forgatókönyv legalább egyszer előfordul (a lista rövidebb a dokumentumszámnál). */
const PLANS: { name: PlanName; weight: number }[] = [
  { name: 'approvedOnce', weight: 8 },
  { name: 'approvedMany', weight: 6 },
  { name: 'pendingNew', weight: 3 },
  { name: 'pendingUpdate', weight: 3 },
  { name: 'pendingVacated', weight: 1 },
  { name: 'rejectedNew', weight: 3 },
  { name: 'rejectedUpdate', weight: 2 },
  { name: 'draftOnly', weight: 4 },
  { name: 'draftAfterApproved', weight: 3 },
  { name: 'withdrawn', weight: 1 },
  { name: 'archived', weight: 2 },
  { name: 'unarchived', weight: 1 },
  { name: 'discarded', weight: 1 },
];

const BASE_DOCS = 40;
const DUPLICATES = 2;

export function isActiveMember(space: SeedSpace, userId: string): boolean {
  return (
    space.members.some((m) => m.userId === userId) &&
    !space.removed.some((r) => r.userId === userId)
  );
}

export function buildSeedPlan(seed = 20261023): SeedPlan {
  const rng = makeRng(seed);
  const at = (days: number, hours = 0): Date =>
    new Date(SEED_BASE.getTime() + days * DAY + hours * 3600_000);

  // Felhasználók: az első a Rendszeradmin.
  const users: SeedUser[] = USERS.map((u, i) => ({
    id: rng.uuid(),
    email: `${u.local}@example.test`,
    displayName: u.name,
    systemRole: i === 0 ? 'system_admin' : 'user',
    createdAt: at(-30 + i),
  }));
  const admin = users[0] as SeedUser;
  const userIds = users.map((u) => u.id);
  // A „kilépő” tag: nem tulajdonos, nem indítványozó, csak a kiesős review-hely szereplője (D51 b);
  // a Fejlesztés tér tagjai közül kikerül, a hely üres marad.
  const leaverId = (users[users.length - 1] as SeedUser).id;

  // Színterek: Általános (mindenki Szerző, egy gazda), három csapat-tér (3-6 tag), egy projekt-tér.
  const mkSpace = (
    name: string,
    type: SpaceType,
    description: string,
    colorIndex: number,
    memberCount: number,
    managers: number,
  ): SeedSpace => {
    // Az Általánosban mindenki tag (Szerző, a Rendszeradmin is), a gazda a második felhasználó.
    let chosen = type === 'general' ? userIds : rng.pickN(userIds, memberCount);
    if (name === 'Fejlesztés' && !chosen.includes(leaverId)) {
      chosen = [...chosen.slice(0, -1), leaverId]; // a gazdák az elején maradnak
    }
    const managerIds = new Set(
      type === 'general' ? [userIds[1] as string] : chosen.slice(0, managers),
    );
    return {
      id: rng.uuid(),
      name,
      type,
      description,
      color: COLORS[colorIndex % COLORS.length] as string,
      createdBy: admin.id,
      createdAt: at(-20 + colorIndex),
      removed: [],
      members: chosen.map((userId) => ({
        userId,
        role: managerIds.has(userId) ? ('space_manager' as const) : ('author' as const),
      })),
    };
  };
  const spaces: SeedSpace[] = [
    mkSpace('Általános', 'general', 'Közös tudás, minden felhasználónak', 0, userIds.length, 1),
    mkSpace('Adatplatform csapat', 'team', 'Adatmérnöki és riport-eszközök', 1, 5, 1),
    mkSpace('Ügyfélszolgálat', 'team', 'Ügyfélkommunikációs asszisztensek', 2, 4, 1),
    mkSpace('Fejlesztés', 'team', 'Fejlesztői asszisztensek és kódreview', 3, 6, 2),
    mkSpace('Pilot projekt', 'project', 'Az AI-asszisztens bevezetési projektje', 4, 3, 1),
  ];

  const kinds: SeedKind[] = KINDS.map((k, i) => ({ key: k.key, label: k.label, sortOrder: i }));
  const tags: SeedTag[] = TAGS.map((name) => ({
    id: rng.uuid(),
    name,
    normalizedName: normalizeTag(name),
    createdBy: rng.pick(userIds),
    createdAt: at(-15),
  }));

  // Dokumentum-vázak: cím, fajta, tér, forgatókönyv.
  const titlePool = rng
    .shuffle(KINDS.flatMap((k) => k.titles.map((title) => ({ title, kind: k.key }))))
    .slice(0, BASE_DOCS);
  // A kiesős review-hely forgatókönyve pontosan egyszer szerepel (a „kilépő” tag egyszer esik ki).
  const planPool = rng.shuffle(
    PLANS.filter((p) => p.name !== 'pendingVacated').flatMap((p) =>
      Array<PlanName>(p.weight).fill(p.name),
    ),
  );
  // Garantált lefedés: először minden forgatókönyv egyszer, utána a súlyozott lista.
  const planOrder: PlanName[] = [...rng.shuffle(PLANS.map((p) => p.name)), ...planPool];
  const spaceCycle = [0, 0, 1, 1, 2, 2, 3, 3, 0, 1, 2, 3, 4, 0, 1, 3];

  const docs: SeedDoc[] = [];
  const usedSlugs = new Set<string>();

  const newDoc = (
    title: string,
    kind: string,
    spaceIndex: number,
    name: PlanName,
    index: number,
  ): SeedDoc => {
    const space = spaces[spaceIndex] as SeedSpace;
    const memberIds = space.members.map((m) => m.userId);
    const owner = rng.pick(memberIds.filter((id) => id !== leaverId));
    const createdAt = at(rng.between(0, 55), rng.between(0, 8));
    let slug = slugify(title);
    while (usedSlugs.has(`${space.id}/${slug}`)) slug = `${slug}-${index}`;
    usedSlugs.add(`${space.id}/${slug}`);
    // 1-2 kezdeti címke: a metadata kérés egyet hozzáad, így a végén legfeljebb három van (H5 WP1: 1-3).
    const tagIds = rng.pickN(tags, rng.between(1, 2)).map((t) => t.id);
    const doc: SeedDoc = {
      id: rng.uuid(),
      spaceId: space.id,
      slug,
      title,
      kind,
      ownerId: owner,
      createdAt,
      initialContent: makeContent(rng, title, 1),
      tagIds,
      links: [],
      steps: [],
      finalState: 'draft',
      archived: false,
      discarded: false,
      iteration: 0,
      reviewDueAt: null,
      duplicatedFromId: null,
      dueSoonEventAt: null,
    };
    scriptDoc(doc, space, name);
    return doc;
  };

  function scriptDoc(doc: SeedDoc, space: SeedSpace, name: PlanName): void {
    // A kilépő csak a kiesős review-helyen szerepel; máshol nem tulajdonos, indítványozó vagy review-er.
    const memberIds = space.members.map((m) => m.userId).filter((id) => id !== leaverId);
    let clock = doc.createdAt.getTime();
    const tick = (): Date => {
      clock += rng.between(4, 60) * 3600_000;
      return new Date(clock);
    };
    let version = 1;
    let liveContent = doc.initialContent;
    const liveTitle = doc.title;
    let liveTagIds = [...doc.tagIds];
    let approvedRevisionId: string | null = null;
    let iteration = 0;
    let lastDue: Date | null = null;
    let approvedState = false; // a dokumentum Jóváhagyott állapotban van: szerkesztés előtt „Módosítás indítása” kell (D51 c)

    const snapshot = (): SeedRevision['metadata'] => ({
      kind: doc.kind,
      tagIds: [...liveTagIds].sort(),
      links: [], // a kapcsolatok a terv végén kerülnek a pillanatképbe (lásd fentebb: attachLinks)
    });
    const mkRevision = (message: string | null): SeedRevision => {
      const authorId = rng.pick(memberIds);
      const rev: SeedRevision = {
        id: rng.uuid(),
        title: liveTitle,
        content: liveContent,
        metadata: snapshot(),
        authorId,
        contributors: Array.from(new Set([authorId, doc.ownerId])),
        message,
        createdAt: tick(),
      };
      return rev;
    };
    const pickReviewers = (initiator: string): [string, string] => {
      const [a, b] = rng.pickN(
        memberIds.filter((id) => id !== initiator),
        2,
      );
      return [a as string, b as string];
    };
    const editStart = (changeContent = true): void => {
      if (changeContent) {
        version += 1;
        liveContent = makeContent(rng, liveTitle, version);
      }
      doc.steps.push({ t: 'edit_start', at: tick(), liveContent });
      approvedState = false;
    };
    const checkpoint = (): void => {
      if (approvedState) editStart();
      version += 1;
      liveContent = makeContent(rng, liveTitle, version);
      doc.steps.push({
        t: 'checkpoint',
        revision: mkRevision(rng.chance(0.5) ? 'Köztes mentés' : null),
      });
    };
    const submit = (
      kind: ChangeKind,
      outcomeAfter: Outcome,
      addTag = false,
      vacatedFor: string | null = null,
    ): SeedChange => {
      const initiator = rng.chance(0.7) ? doc.ownerId : rng.pick(memberIds);
      if ((kind === 'update' || kind === 'metadata') && approvedState) {
        editStart(kind === 'update'); // a metaadat-változás tartalmat nem módosít
      } else if (kind === 'update') {
        version += 1;
        liveContent = makeContent(rng, liveTitle, version);
      }
      let addTagId: string | null = null;
      if (kind === 'metadata' || addTag) {
        const free = tags.map((t) => t.id).filter((id) => !liveTagIds.includes(id));
        addTagId = rng.pick(free);
        liveTagIds = [...liveTagIds, addTagId];
      }
      const withProposal = kind !== 'delete' && kind !== 'unarchive';
      const revision = withProposal
        ? mkRevision(rng.chance(0.6) ? 'Javított változat' : null)
        : null;
      const createdAt = tick();
      const due = withProposal ? new Date(createdAt.getTime() + 365 * DAY) : null;
      const change: SeedChange = {
        id: rng.uuid(),
        kind,
        baseRevisionId: kind === 'create' ? null : approvedRevisionId,
        proposedRevisionId: revision?.id ?? null,
        initiatorId: initiator,
        reviewers: vacatedFor
          ? [vacatedFor, pickReviewers(initiator)[0]]
          : pickReviewers(initiator),
        message: rng.chance(0.5) ? 'Kérem a jóváhagyást' : null,
        proposedReviewDueAt: due,
        createdAt,
        outcome: outcomeAfter,
        decidedAt: null,
        iteration: null,
        rejection: null,
      };
      doc.steps.push({
        t: 'submit',
        change,
        revision,
        liveTitle,
        liveContent,
        addTagId,
      });
      if (outcomeAfter !== 'pending') {
        change.decidedAt = tick();
        approvedState = outcomeAfter === 'approved';
        if (outcomeAfter === 'approved') {
          iteration += 1;
          change.iteration = iteration;
          if (revision) approvedRevisionId = revision.id;
          if (due) lastDue = due;
        }
        if (outcomeAfter === 'rejected') {
          change.rejection = {
            reviewerId: rng.pick(change.reviewers),
            reason: 'A leírás hiányos, kérem pontosítani a használati szakaszt.',
          };
        }
        doc.steps.push({ t: 'resolve', change });
      }
      return change;
    };

    switch (name) {
      case 'approvedOnce':
        submit('create', 'approved');
        break;
      case 'approvedMany': {
        submit('create', 'approved');
        if (rng.chance(0.5)) checkpoint();
        submit(rng.chance(0.5) ? 'update' : 'metadata', 'approved');
        if (rng.chance(0.5)) submit('update', 'approved');
        break;
      }
      case 'pendingNew':
        submit('create', 'pending');
        break;
      case 'pendingUpdate':
        submit('create', 'approved');
        submit('update', 'pending');
        break;
      case 'pendingVacated': {
        const change = submit('create', 'pending', false, leaverId);
        doc.steps.push({ t: 'vacate', changeId: change.id, reviewerId: leaverId, at: tick() });
        space.removed.push({ userId: leaverId, at: new Date(clock) });
        break;
      }
      case 'rejectedNew':
        submit('create', 'rejected');
        break;
      case 'rejectedUpdate':
        submit('create', 'approved');
        submit('update', 'rejected');
        break;
      case 'draftOnly':
        for (let i = rng.between(0, 2); i > 0; i--) checkpoint();
        break;
      case 'draftAfterApproved':
        submit('create', 'approved');
        editStart();
        checkpoint();
        break;
      case 'withdrawn':
        submit('create', 'withdrawn');
        break;
      case 'archived':
        submit('create', 'approved');
        submit('delete', 'approved');
        doc.archived = true;
        break;
      case 'unarchived':
        submit('create', 'approved');
        submit('delete', 'approved');
        submit('unarchive', 'approved');
        break;
      case 'discarded':
        checkpoint();
        doc.steps.push({ t: 'discard', at: tick() });
        doc.discarded = true;
        break;
    }

    // Végállapot a lépésekből.
    const last = [...doc.steps]
      .reverse()
      .find((s) => s.t === 'submit' || s.t === 'resolve' || s.t === 'edit_start');
    let state: ReviewState = 'draft';
    if (last?.t === 'resolve') {
      const o = last.change.outcome;
      state = o === 'approved' ? 'approved' : o === 'rejected' ? 'changes_requested' : 'draft';
    } else if (last?.t === 'submit') {
      state = 'pending';
    }
    doc.finalState = state;
    doc.iteration = iteration;
    doc.reviewDueAt = lastDue;
  }

  // Alap-dokumentumok.
  titlePool.forEach((entry, i) => {
    // A kiesős review-helyes forgatókönyv a Fejlesztés térbe kerül (ott tag a „kilépő”).
    const name = planOrder[i] as PlanName;
    const spaceIndex =
      name === 'pendingVacated' ? 3 : (spaceCycle[i % spaceCycle.length] as number);
    docs.push(newDoc(entry.title, entry.kind, spaceIndex, name, i));
  });

  // Duplikátumok: Jóváhagyott csapat-dokumentum másolata az Általánosba (`szarmazik` kapcsolat, `duplicated_from`).
  const sources = docs.filter(
    (d) => d.finalState === 'approved' && !d.archived && d.spaceId !== (spaces[0] as SeedSpace).id,
  );
  for (const source of rng.pickN(sources, DUPLICATES)) {
    const copy = newDoc(`${source.title} (másolat)`, source.kind, 0, 'draftOnly', docs.length);
    copy.duplicatedFromId = source.id;
    copy.ownerId = source.ownerId; // az Általánosnak és a forrás-térnek is tagja (D44: kapcsolat csak saját színtérre)
    copy.links.push({ toId: source.id, type: 'szarmazik', anchorText: null });
    docs.push(copy);
  }

  // Kézi kapcsolatok: azonos színtéren belül, Jóváhagyott (nem archivált, nem eldobott) célra; egy `helyettesiti`.
  const linkable = docs.filter((d) => !d.archived && !d.discarded);
  let replaced = false;
  for (const doc of linkable) {
    if (!rng.chance(0.45)) continue;
    const targets = linkable.filter((t) => t.spaceId === doc.spaceId && t.id !== doc.id);
    if (targets.length === 0) continue;
    const target = rng.pick(targets);
    let type: LinkType = rng.pick(['hivatkozik', 'hivatkozik', 'epit_ra']);
    if (!replaced && doc.finalState === 'approved' && target.finalState === 'approved') {
      type = 'helyettesiti';
      replaced = true;
    }
    if (!doc.links.some((l) => l.toId === target.id)) {
      doc.links.push({
        toId: target.id,
        type,
        anchorText: type === 'hivatkozik' ? target.title : null,
      });
    }
  }
  // A revíziók pillanatképébe a dokumentum (végleges) kapcsolatlistája kerül.
  for (const doc of docs) {
    const links = doc.links.map((l) => ({ toId: l.toId, type: l.type, anchor: l.anchorText }));
    for (const step of doc.steps) {
      const rev = step.t === 'checkpoint' || step.t === 'submit' ? step.revision : null;
      if (rev) rev.metadata.links = links;
    }
  }

  // Esedékességek: két dokumentum már lejárt, kettő hamarosan esedékes (a felülvizsgálati facetekhez).
  // Az esedékesség a jóváhagyott kérés `proposed_review_due_at` mezőjéből kerül a dokumentumba (D51 f), ezért ott módosítjuk.
  const setDue = (doc: SeedDoc, due: Date): void => {
    let change: SeedChange | undefined;
    for (const step of doc.steps) {
      if (
        step.t === 'resolve' &&
        step.change.outcome === 'approved' &&
        step.change.proposedReviewDueAt
      ) {
        change = step.change; // az utolsó ilyen számít
      }
    }
    if (change) {
      change.proposedReviewDueAt = due;
      doc.reviewDueAt = due;
    }
  };
  const approvedDocs = docs.filter(
    (d) => d.finalState === 'approved' && !d.archived && d.reviewDueAt,
  );
  approvedDocs.slice(0, 2).forEach((d) => setDue(d, at(70 + rng.between(0, 5))));
  approvedDocs.slice(2, 4).forEach((d) => {
    setDue(d, at(100 + rng.between(0, 5)));
    d.dueSoonEventAt = at(93);
  });

  // Kommentek.
  const comments: SeedComment[] = [];
  for (const doc of docs) {
    if (doc.discarded || !rng.chance(0.6)) continue;
    const space = spaces.find((s) => s.id === doc.spaceId) as SeedSpace;
    for (let i = rng.between(1, 3); i > 0; i--) {
      const createdAt = new Date(doc.createdAt.getTime() + rng.between(1, 20) * DAY);
      const edited = rng.chance(0.15);
      comments.push({
        id: rng.uuid(),
        documentId: doc.id,
        authorId: rng.pick(space.members).userId,
        content: rng.pick(COMMENT_TEXTS),
        createdAt,
        editedAt: edited ? new Date(createdAt.getTime() + 3600_000) : null,
        deletedAt: rng.chance(0.1) ? new Date(createdAt.getTime() + 2 * DAY) : null,
      });
    }
  }

  // Kedvencek (privát) és követések: csak olyan dokumentum, amelynek a felhasználó tagja; a tulajdonos követi a sajátját.
  const favorites: SeedPlan['favorites'] = [];
  for (const user of users) {
    const visible = docs.filter(
      (d) =>
        !d.discarded &&
        !d.archived &&
        isActiveMember(spaces.find((s) => s.id === d.spaceId) as SeedSpace, user.id),
    );
    for (const doc of rng.pickN(visible, rng.between(2, 4))) {
      favorites.push({ userId: user.id, documentId: doc.id, createdAt: at(rng.between(5, 60)) });
    }
  }
  const subscriptions: SeedPlan['subscriptions'] = docs
    .filter((d) => !d.discarded)
    .map((d) => ({ userId: d.ownerId, documentId: d.id, createdAt: d.createdAt }));

  return { seed, users, spaces, kinds, tags, docs, comments, favorites, subscriptions };
}
