import { count, and, eq, isNull } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as t from './schema.js';
import {
  buildSeedPlan,
  type SeedChange,
  type SeedDoc,
  type SeedPlan,
  type SeedRevision,
  type Step,
} from './seed-data.js';

/**
 * A seed végrehajtása a `taltos_app` szerepkörrel (a backend login-szerepköre): ez bizonyítja, hogy az app jogai elegendők,
 * és a seed ugyanazokon a DB-invariánsokon megy át, mint a későbbi `ReviewService` (D11, dummy adat, B4).
 * A dokumentumok élettörténetét lépésenként, külön tranzakcióban hajtja végre: a beküldés (két review-er, halasztott
 * trigger) és a döntés ugyanúgy két commit, mint élesben.
 */
type Db = NodePgDatabase;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

interface NewEvent {
  type: string;
  spaceId?: string | null;
  documentId?: string | null;
  changeRequestId?: string | null;
  actorId: string | null;
  details?: Record<string, unknown>;
  createdAt: Date;
}

async function addEvent(tx: Tx, e: NewEvent): Promise<number> {
  const [row] = await tx
    .insert(t.events)
    .values({
      type: e.type,
      spaceId: e.spaceId ?? null,
      documentId: e.documentId ?? null,
      changeRequestId: e.changeRequestId ?? null,
      actorId: e.actorId,
      details: e.details ?? null,
      createdAt: e.createdAt,
    })
    .returning({ id: t.events.id });
  if (!row) throw new Error('Az esemény beszúrása nem adott vissza azonosítót.');
  return row.id;
}

export interface SeedResult {
  users: number;
  spaces: number;
  documents: number;
  changeRequests: number;
  events: number;
}

export async function runSeed(
  pool: pg.Pool,
  plan: SeedPlan = buildSeedPlan(),
): Promise<SeedResult> {
  const db: Db = drizzle(pool);

  const [existing] = await db.select({ n: count() }).from(t.users);
  if (!existing || existing.n > 0) {
    throw new Error(
      'Az adatbázis nem üres: a seed csak üres (friss) adatbázisra fut. Építsd újra a DB-t.',
    );
  }

  const spaceById = new Map(plan.spaces.map((s) => [s.id, s]));
  const managerOf = (spaceId: string): string => {
    const m = spaceById.get(spaceId)?.members.find((x) => x.role === 'space_manager');
    if (!m) throw new Error('A színtérnek nincs Színtérgazdája.');
    return m.userId;
  };
  const admin = plan.users.find((u) => u.systemRole === 'system_admin');
  if (!admin) throw new Error('A tervben nincs Rendszeradmin.');

  // 1. Alap-adatok: felhasználók, allowlist, színterek, tagság, fajták, címkék, az ezekhez tartozó események.
  await db.transaction(async (tx) => {
    await tx.insert(t.users).values(
      plan.users.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        systemRole: u.systemRole,
        createdAt: u.createdAt,
        lastLoginAt: u.createdAt,
      })),
    );
    await tx.insert(t.allowlist).values(
      plan.users.map((u) => ({
        email: u.email,
        note: 'seed',
        addedBy: null,
        createdAt: u.createdAt,
      })),
    );
    for (const u of plan.users) {
      // Konfigból seedelt allowlist: nincs emberi aktor (D51 d); az esemény nem hordoz e-mailt.
      await addEvent(tx, {
        type: 'allowlist_added',
        actorId: null,
        details: { source: 'config' },
        createdAt: u.createdAt,
      });
    }
    for (const s of plan.spaces) {
      await tx.insert(t.spaces).values({
        id: s.id,
        name: s.name,
        type: s.type,
        description: s.description,
        color: s.color,
        createdBy: s.createdBy,
        createdAt: s.createdAt,
      });
      await tx.insert(t.spaceMembers).values(
        s.members.map((m) => ({
          spaceId: s.id,
          userId: m.userId,
          role: m.role,
          addedBy: s.createdBy,
          createdAt: s.createdAt,
        })),
      );
      await addEvent(tx, {
        type: 'space_created',
        spaceId: s.id,
        actorId: s.createdBy,
        createdAt: s.createdAt,
      });
      for (const m of s.members) {
        await addEvent(tx, {
          type: m.role === 'space_manager' ? 'space_manager_assigned' : 'member_added',
          spaceId: s.id,
          actorId: s.createdBy,
          details: { userId: m.userId, role: m.role },
          createdAt: s.createdAt,
        });
      }
    }
    await tx.insert(t.documentKinds).values(plan.kinds);
    await tx.insert(t.tags).values(plan.tags);
    for (const tag of plan.tags) {
      await addEvent(tx, {
        type: 'tag_created',
        actorId: tag.createdBy,
        details: { tagId: tag.id },
        createdAt: tag.createdAt,
      });
    }
  });

  // 2. Dokumentumok lépésenként.
  let changeCount = 0;
  for (const doc of plan.docs) {
    changeCount += doc.steps.filter((s) => s.t === 'submit').length;
    await seedDocument(db, doc, managerOf);
  }

  // 3. Kapcsolatok, kommentek, kedvencek, követések.
  await db.transaction(async (tx) => {
    const docById = new Map(plan.docs.map((d) => [d.id, d]));
    for (const doc of plan.docs) {
      for (const link of doc.links) {
        await tx.insert(t.documentLinks).values({
          fromId: doc.id,
          toId: link.toId,
          type: link.type,
          anchorText: link.anchorText,
          createdBy: doc.ownerId,
          createdAt: doc.createdAt,
        });
        await addEvent(tx, {
          type: 'link_added',
          spaceId: doc.spaceId,
          documentId: doc.id,
          actorId: doc.ownerId,
          details: { toId: link.toId, type: link.type },
          createdAt: doc.createdAt,
        });
      }
      if (doc.duplicatedFromId) {
        const source = docById.get(doc.duplicatedFromId);
        if (!source) throw new Error('A duplikálás forrása hiányzik a tervből.');
        // `duplicated_from` mindkét dokumentumnál megjelenik (D17).
        await addEvent(tx, {
          type: 'duplicated_from',
          spaceId: doc.spaceId,
          documentId: doc.id,
          actorId: doc.ownerId,
          details: { sourceId: source.id },
          createdAt: doc.createdAt,
        });
        await addEvent(tx, {
          type: 'duplicated_from',
          spaceId: source.spaceId,
          documentId: source.id,
          actorId: doc.ownerId,
          details: { copyId: doc.id },
          createdAt: doc.createdAt,
        });
      }
      if (doc.dueSoonEventAt) {
        // Cron-esemény: nincs emberi aktor (D51 d).
        await addEvent(tx, {
          type: 'review_due_soon',
          spaceId: doc.spaceId,
          documentId: doc.id,
          actorId: null,
          createdAt: doc.dueSoonEventAt,
        });
      }
    }
    if (plan.comments.length > 0) {
      await tx.insert(t.comments).values(plan.comments);
      for (const c of plan.comments) {
        const doc = docById.get(c.documentId);
        if (!doc) throw new Error('A komment dokumentuma hiányzik a tervből.');
        await addEvent(tx, {
          type: 'comment_created',
          spaceId: doc.spaceId,
          documentId: doc.id,
          actorId: c.authorId,
          details: { commentId: c.id },
          createdAt: c.createdAt,
        });
        if (c.deletedAt) {
          await addEvent(tx, {
            type: 'comment_deleted',
            spaceId: doc.spaceId,
            documentId: doc.id,
            actorId: c.authorId,
            details: { commentId: c.id },
            createdAt: c.deletedAt,
          });
        }
      }
    }
    await tx.insert(t.favorites).values(plan.favorites);
    await tx.insert(t.subscriptions).values(plan.subscriptions);
  });

  const [events] = await db.select({ n: count() }).from(t.events);
  return {
    users: plan.users.length,
    spaces: plan.spaces.length,
    documents: plan.docs.length,
    changeRequests: changeCount,
    events: events?.n ?? 0,
  };
}

async function seedDocument(
  db: Db,
  doc: SeedDoc,
  managerOf: (spaceId: string) => string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(t.documents).values({
      id: doc.id,
      spaceId: doc.spaceId,
      slug: doc.slug,
      title: doc.title,
      kind: doc.kind,
      ownerId: doc.ownerId,
      content: doc.initialContent,
      reviewState: 'draft',
      freshnessAt: doc.createdAt,
      createdBy: doc.ownerId,
      createdAt: doc.createdAt,
      updatedAt: doc.createdAt,
    });
    // A címkék után a document_tags trigger tölti a tag_text-et (B4 S9).
    await tx
      .insert(t.documentTags)
      .values(doc.tagIds.map((tagId) => ({ documentId: doc.id, tagId })));
    await addEvent(tx, {
      type: 'created',
      spaceId: doc.spaceId,
      documentId: doc.id,
      actorId: doc.ownerId,
      createdAt: doc.createdAt,
    });
  });

  for (const step of doc.steps) {
    await db.transaction((tx) => applyStep(tx, doc, step, managerOf));
  }
}

async function insertRevision(tx: Tx, doc: SeedDoc, rev: SeedRevision): Promise<void> {
  await tx.insert(t.documentRevisions).values({
    id: rev.id,
    documentId: doc.id,
    title: rev.title,
    content: rev.content,
    metadata: rev.metadata,
    authorId: rev.authorId,
    contributors: rev.contributors,
    message: rev.message,
    createdAt: rev.createdAt,
  });
}

async function applyStep(
  tx: Tx,
  doc: SeedDoc,
  step: Step,
  managerOf: (spaceId: string) => string,
): Promise<void> {
  const base = { spaceId: doc.spaceId, documentId: doc.id };
  switch (step.t) {
    case 'checkpoint': {
      await insertRevision(tx, doc, step.revision);
      await tx
        .update(t.documents)
        .set({ content: step.revision.content, updatedAt: step.revision.createdAt })
        .where(eq(t.documents.id, doc.id));
      await addEvent(tx, {
        ...base,
        type: 'edited',
        actorId: step.revision.authorId,
        details: { contributors: step.revision.contributors },
        createdAt: step.revision.createdAt,
      });
      return;
    }
    case 'submit':
      return submitChange(tx, doc, step);
    case 'vacate': {
      // A review-er kikerül a színtérből: a hely megszűnik (D51 b), a másik döntése és a kérés marad.
      await tx
        .update(t.changeRequestReviewers)
        .set({ endedAt: step.at, endReason: 'removed' })
        .where(
          and(
            eq(t.changeRequestReviewers.changeRequestId, step.changeId),
            eq(t.changeRequestReviewers.reviewerId, step.reviewerId),
            isNull(t.changeRequestReviewers.endedAt),
          ),
        );
      await tx
        .update(t.spaceMembers)
        .set({ removedAt: step.at })
        .where(
          and(eq(t.spaceMembers.spaceId, doc.spaceId), eq(t.spaceMembers.userId, step.reviewerId)),
        );
      const manager = managerOf(doc.spaceId);
      await addEvent(tx, {
        type: 'member_removed',
        spaceId: doc.spaceId,
        actorId: manager,
        details: { userId: step.reviewerId },
        createdAt: step.at,
      });
      const eventId = await addEvent(tx, {
        ...base,
        type: 'reviewer_removed',
        changeRequestId: step.changeId,
        actorId: manager,
        details: { reviewerId: step.reviewerId },
        createdAt: step.at,
      });
      const initiator = doc.steps.flatMap((s) =>
        s.t === 'submit' && s.change.id === step.changeId ? [s.change.initiatorId] : [],
      )[0];
      if (initiator) {
        await tx
          .insert(t.notifications)
          .values({ userId: initiator, eventId, category: 'reviewer_vacated', createdAt: step.at });
      }
      return;
    }
    case 'resolve':
      return resolveChange(tx, doc, step.change);
    case 'edit_start': {
      // Jóváhagyott → Piszkozat: explicit „Módosítás indítása” (D51 c).
      await tx
        .update(t.documents)
        .set({ reviewState: 'draft', content: step.liveContent, updatedAt: step.at })
        .where(eq(t.documents.id, doc.id));
      await addEvent(tx, {
        ...base,
        type: 'edit_started',
        actorId: doc.ownerId,
        createdAt: step.at,
      });
      return;
    }
    case 'discard': {
      // Soha be nem küldött piszkozat eldobása: soft delete, review nélkül (D45).
      await tx
        .update(t.documents)
        .set({ deletedAt: step.at, updatedAt: step.at })
        .where(eq(t.documents.id, doc.id));
      await addEvent(tx, {
        ...base,
        type: 'draft_discarded',
        actorId: doc.ownerId,
        createdAt: step.at,
      });
      return;
    }
  }
}

async function submitChange(
  tx: Tx,
  doc: SeedDoc,
  step: Extract<Step, { t: 'submit' }>,
): Promise<void> {
  const c = step.change;
  const base = { spaceId: doc.spaceId, documentId: doc.id };
  // A beküldés előtt az élő állapot a javasolt változat (Piszkozat vagy Jóváhagyott állapotban még írható).
  await tx
    .update(t.documents)
    .set({ title: step.liveTitle, content: step.liveContent, updatedAt: c.createdAt })
    .where(eq(t.documents.id, doc.id));
  if (step.addTagId) {
    await tx.insert(t.documentTags).values({ documentId: doc.id, tagId: step.addTagId });
  }
  if (step.revision) await insertRevision(tx, doc, step.revision);
  await tx.insert(t.changeRequests).values({
    id: c.id,
    documentId: doc.id,
    kind: c.kind,
    baseRevisionId: c.baseRevisionId,
    proposedRevisionId: c.proposedRevisionId,
    proposedReviewDueAt: c.proposedReviewDueAt,
    initiatorId: c.initiatorId,
    message: c.message,
    state: 'pending',
    createdAt: c.createdAt,
  });
  await tx.insert(t.changeRequestReviewers).values(
    c.reviewers.map((reviewerId) => ({
      changeRequestId: c.id,
      reviewerId,
      assignedAt: c.createdAt,
    })),
  );
  const eventId = await addEvent(tx, {
    ...base,
    type: 'review_requested',
    changeRequestId: c.id,
    actorId: c.initiatorId,
    details: { kind: c.kind, reviewerIds: c.reviewers },
    createdAt: c.createdAt,
  });
  await tx.insert(t.notifications).values(
    c.reviewers.map((userId) => ({
      userId,
      eventId,
      category: 'review_request',
      emailDue: true, // a review-kérésről azonnali levél megy (D46)
      createdAt: c.createdAt,
    })),
  );
  await tx
    .update(t.documents)
    .set({ reviewState: 'pending', updatedAt: c.createdAt })
    .where(eq(t.documents.id, doc.id));
}

async function resolveChange(tx: Tx, doc: SeedDoc, c: SeedChange): Promise<void> {
  const decidedAt = c.decidedAt;
  if (!decidedAt) throw new Error('A lezárt kérésnek van döntési ideje.');
  const base = { spaceId: doc.spaceId, documentId: doc.id, changeRequestId: c.id };
  const reviewerRows = t.changeRequestReviewers;
  const open = and(eq(reviewerRows.changeRequestId, c.id), isNull(reviewerRows.endedAt));

  if (c.outcome === 'approved') {
    await tx.update(reviewerRows).set({ decision: 'approved', decidedAt }).where(open);
    await tx
      .update(t.changeRequests)
      .set({ state: 'approved', decidedAt, iteration: c.iteration })
      .where(eq(t.changeRequests.id, c.id));
    await tx
      .update(t.documents)
      .set({
        reviewState: 'approved',
        iteration: c.iteration ?? 0,
        freshnessAt: decidedAt,
        updatedAt: decidedAt,
        ...(c.proposedRevisionId ? { approvedRevisionId: c.proposedRevisionId } : {}),
        ...(c.proposedReviewDueAt ? { reviewDueAt: c.proposedReviewDueAt } : {}),
        ...(c.kind === 'delete' ? { deletedAt: decidedAt } : {}),
        ...(c.kind === 'unarchive' ? { deletedAt: null } : {}),
      })
      .where(eq(t.documents.id, doc.id));
    for (const reviewerId of c.reviewers) {
      await addEvent(tx, {
        ...base,
        type: 'review_approved',
        actorId: reviewerId,
        createdAt: decidedAt,
      });
    }
    const last = c.reviewers[1];
    const eventId = await addEvent(tx, {
      ...base,
      type: 'change_approved',
      actorId: last,
      details: { kind: c.kind, iteration: c.iteration },
      createdAt: decidedAt,
    });
    if (c.proposedReviewDueAt) {
      await addEvent(tx, {
        ...base,
        type: 'review_due_set',
        actorId: last,
        details: { dueAt: c.proposedReviewDueAt.toISOString() },
        createdAt: decidedAt,
      });
    }
    if (c.kind === 'delete')
      await addEvent(tx, { ...base, type: 'archived', actorId: last, createdAt: decidedAt });
    if (c.kind === 'unarchive')
      await addEvent(tx, { ...base, type: 'unarchived', actorId: last, createdAt: decidedAt });
    await tx
      .insert(t.notifications)
      .values({ userId: c.initiatorId, eventId, category: 'own_request', createdAt: decidedAt });
    return;
  }

  if (c.outcome === 'rejected') {
    const rej = c.rejection;
    if (!rej) throw new Error('Az elutasított kérésnek van indoklása.');
    await tx
      .update(reviewerRows)
      .set({ decision: 'rejected', reason: rej.reason, decidedAt })
      .where(and(open, eq(reviewerRows.reviewerId, rej.reviewerId)));
    // A másik, el nem döntött hely a lezáráskor megszűnik (D51 b, S15).
    await tx
      .update(reviewerRows)
      .set({ endedAt: decidedAt, endReason: 'closed' })
      .where(and(open, isNull(reviewerRows.decision)));
    await tx
      .update(t.changeRequests)
      .set({ state: 'rejected', decidedAt })
      .where(eq(t.changeRequests.id, c.id));
    await tx
      .update(t.documents)
      .set({ reviewState: 'changes_requested', updatedAt: decidedAt })
      .where(eq(t.documents.id, doc.id));
    await addEvent(tx, {
      ...base,
      type: 'review_rejected',
      actorId: rej.reviewerId,
      details: { reason: rej.reason },
      createdAt: decidedAt,
    });
    const eventId = await addEvent(tx, {
      ...base,
      type: 'change_rejected',
      actorId: rej.reviewerId,
      createdAt: decidedAt,
    });
    await tx.insert(t.notifications).values({
      userId: c.initiatorId,
      eventId,
      category: 'changes_requested',
      createdAt: decidedAt,
    });
    return;
  }

  // Visszavonás: minden el nem döntött hely lezárul, a dokumentum újra Piszkozat.
  await tx.update(reviewerRows).set({ endedAt: decidedAt, endReason: 'closed' }).where(open);
  await tx
    .update(t.changeRequests)
    .set({ state: 'withdrawn', decidedAt })
    .where(eq(t.changeRequests.id, c.id));
  await tx
    .update(t.documents)
    .set({ reviewState: 'draft', updatedAt: decidedAt })
    .where(eq(t.documents.id, doc.id));
  await addEvent(tx, {
    ...base,
    type: 'review_withdrawn',
    actorId: c.initiatorId,
    createdAt: decidedAt,
  });
}
