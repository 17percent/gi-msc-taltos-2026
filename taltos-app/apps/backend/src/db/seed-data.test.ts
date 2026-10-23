import { describe, expect, it } from 'vitest';
import {
  buildSeedPlan,
  isActiveMember,
  normalizeTag,
  slugify,
  type SeedChange,
  type SeedDoc,
  type SeedPlan,
} from './seed-data.js';

const plan = buildSeedPlan();
const changesOf = (doc: SeedDoc): SeedChange[] =>
  doc.steps.flatMap((s) => (s.t === 'submit' ? [s.change] : []));
const spaceOf = (p: SeedPlan, id: string) => p.spaces.find((s) => s.id === id)!;

describe('seed-terv (D11, H5 WP1) - adatbázis nélkül', () => {
  it('determinisztikus: ugyanaz a seed ugyanazt, másik seed mást ad', () => {
    expect(JSON.stringify(buildSeedPlan(7))).toBe(JSON.stringify(buildSeedPlan(7)));
    expect(JSON.stringify(buildSeedPlan(7))).not.toBe(JSON.stringify(buildSeedPlan(8)));
  });

  it('csak kitalált, @example.test címek; az első felhasználó a Rendszeradmin', () => {
    expect(plan.users.length).toBeGreaterThanOrEqual(10);
    expect(plan.users.every((u) => /^[a-z.]+@example\.test$/.test(u.email))).toBe(true);
    expect(plan.users.filter((u) => u.systemRole === 'system_admin')).toHaveLength(1);
    expect(new Set(plan.users.map((u) => u.email)).size).toBe(plan.users.length);
  });

  it('az Általános egyetlen, minden felhasználó Szerző benne, egy Színtérgazdával', () => {
    const general = plan.spaces.filter((s) => s.type === 'general');
    expect(general).toHaveLength(1);
    const g = general[0]!;
    expect(g.members).toHaveLength(plan.users.length);
    expect(g.members.filter((m) => m.role === 'space_manager')).toHaveLength(1);
  });

  it('legalább három csapat-tér 3-6 aktív taggal és legalább egy gazdával', () => {
    const teams = plan.spaces.filter((s) => s.type === 'team');
    expect(teams.length).toBeGreaterThanOrEqual(3);
    for (const s of plan.spaces.filter((x) => x.type !== 'general')) {
      const active = s.members.filter((m) => isActiveMember(s, m.userId));
      expect(active.length).toBeGreaterThanOrEqual(3);
      expect(active.length).toBeLessThanOrEqual(6);
      expect(active.some((m) => m.role === 'space_manager')).toBe(true);
    }
  });

  it('a kilenc régi prototípus-kategória a fajta-lista', () => {
    expect(plan.kinds.map((k) => k.key)).toEqual([
      'prompt',
      'skill',
      'guide',
      'template',
      'best_practice',
      'system_prompt',
      'agent',
      'eval_set',
      'mcp_server',
    ]);
    expect(plan.docs.every((d) => plan.kinds.some((k) => k.key === d.kind))).toBe(true);
  });

  it('a címkék normalizáltan egyediek; dokumentumonként 1-3 témacímke', () => {
    expect(new Set(plan.tags.map((t) => t.normalizedName)).size).toBe(plan.tags.length);
    for (const doc of plan.docs) {
      const final = new Set(doc.tagIds);
      for (const step of doc.steps)
        if (step.t === 'submit' && step.addTagId) final.add(step.addTagId);
      expect(final.size).toBeGreaterThanOrEqual(1);
      expect(final.size).toBeLessThanOrEqual(3);
    }
  });

  it('mind a négy review-állapot, az archivált, az eldobott és a kiesős review-hely is megvan', () => {
    const states = new Set(plan.docs.map((d) => d.finalState));
    expect(states).toEqual(new Set(['draft', 'pending', 'changes_requested', 'approved']));
    expect(plan.docs.some((d) => d.archived)).toBe(true);
    expect(plan.docs.some((d) => d.discarded)).toBe(true);
    expect(plan.docs.filter((d) => d.steps.some((s) => s.t === 'vacate'))).toHaveLength(1);
    expect(plan.docs.some((d) => d.duplicatedFromId)).toBe(true);
  });

  it('a slug színterenként egyedi, az azonosítók egyediek', () => {
    const slugs = plan.docs.map((d) => `${d.spaceId}/${d.slug}`);
    expect(new Set(slugs).size).toBe(slugs.length);
    const ids = [
      ...plan.users.map((u) => u.id),
      ...plan.spaces.map((s) => s.id),
      ...plan.tags.map((t) => t.id),
      ...plan.docs.map((d) => d.id),
      ...plan.docs.flatMap((d) => changesOf(d).map((c) => c.id)),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a kérések szabályai: két különböző review-er az indítványozótól különbözően; javasolt revízió és esedékesség fajtánként', () => {
    for (const doc of plan.docs) {
      const members = spaceOf(plan, doc.spaceId).members.map((m) => m.userId);
      for (const c of changesOf(doc)) {
        expect(c.reviewers[0]).not.toBe(c.reviewers[1]);
        expect(c.reviewers).not.toContain(c.initiatorId);
        expect(members).toContain(c.initiatorId);
        c.reviewers.forEach((r) => expect(members).toContain(r));
        const noProposal = c.kind === 'delete' || c.kind === 'unarchive';
        expect(c.proposedRevisionId === null).toBe(noProposal);
        expect(c.proposedReviewDueAt === null).toBe(noProposal);
        expect((c.kind === 'create') === (c.baseRevisionId === null)).toBe(true);
        expect((c.outcome === 'pending') === (c.decidedAt === null)).toBe(true);
        expect((c.outcome === 'approved') === (c.iteration !== null)).toBe(true);
        expect((c.outcome === 'rejected') === (c.rejection !== null)).toBe(true);
      }
    }
  });

  it('az iteration a jóváhagyott kérések sorszáma, a végállapot a lépésekből következik', () => {
    for (const doc of plan.docs) {
      const approved = changesOf(doc).filter((c) => c.outcome === 'approved');
      expect(approved.map((c) => c.iteration)).toEqual(approved.map((_, i) => i + 1));
      expect(doc.iteration).toBe(approved.length);
      const pending = changesOf(doc).filter((c) => c.outcome === 'pending');
      expect(pending.length).toBeLessThanOrEqual(1); // dokumentumonként legfeljebb egy függő kérés
      expect(doc.finalState === 'pending').toBe(pending.length === 1);
      if (doc.finalState === 'approved') expect(doc.iteration).toBeGreaterThan(0);
    }
  });

  it('Jóváhagyott dokumentumot csak „Módosítás indítása” után szerkesztenek (D51 c)', () => {
    for (const doc of plan.docs) {
      let approved = false;
      for (const step of doc.steps) {
        if (step.t === 'checkpoint') expect(approved).toBe(false);
        if (step.t === 'submit' && ['update', 'metadata'].includes(step.change.kind)) {
          expect(approved).toBe(false);
        }
        if (step.t === 'edit_start') approved = false;
        if (step.t === 'resolve') approved = step.change.outcome === 'approved';
      }
    }
  });

  it('a kapcsolatok színtéren belüliek (a szarmazik kivételével), nem mutatnak archivált vagy eldobott célra', () => {
    const byId = new Map(plan.docs.map((d) => [d.id, d]));
    for (const doc of plan.docs) {
      for (const link of doc.links) {
        const target = byId.get(link.toId)!;
        expect(target.id).not.toBe(doc.id);
        expect(target.archived || target.discarded).toBe(false);
        if (link.type !== 'szarmazik') expect(target.spaceId).toBe(doc.spaceId);
      }
    }
  });

  it('kedvencek csak aktív tagságú felhasználóhoz', () => {
    const byId = new Map(plan.docs.map((d) => [d.id, d]));
    for (const f of plan.favorites) {
      const doc = byId.get(f.documentId)!;
      expect(isActiveMember(spaceOf(plan, doc.spaceId), f.userId)).toBe(true);
    }
  });

  it('segédek: ékezetmentes slug és normalizált címke', () => {
    expect(slugify('Ügyfél-email megválaszolása - alap prompt')).toBe(
      'ugyfel-email-megvalaszolasa-alap-prompt',
    );
    expect(normalizeTag('  Ügyfél  szolgálat ')).toBe('ugyfel szolgalat');
  });
});
