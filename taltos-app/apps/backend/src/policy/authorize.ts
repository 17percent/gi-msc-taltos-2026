import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '../http/api.js';
import { sendProblem } from '../http/problem.js';
import type { AccessStore } from './access-store.js';
import { can, type DocumentAction, type SpaceAction, type SystemAction } from './policy.js';
import type { Actor, Decision, DocumentTarget, SpaceTarget } from './targets.js';

/**
 * Útvonal-segédek a `can()` köré (B5 A10): betöltés → döntés → Problem Details. Siker esetén a betöltött célpontot
 * adják vissza, így a kezelőnek nincs második lekérdezése; `undefined`/`false`: a hibaválasz már elment (mint az
 * `authenticateRequest`). A hívás az auth-kapu UTÁN fut (`requireAuth`), a munkamenet frissen kapott szerepével.
 */

function actorOf(request: FastifyRequest): Actor {
  const session = requireAuth(request);
  return { userId: session.userId, systemRole: session.systemRole };
}

/** Elutasítás: `not_space_member` a színtér-részletekkel (D44), a többi a katalógus szerinti kóddal. */
async function sendDenial(
  access: AccessStore,
  reply: FastifyReply,
  actor: Actor,
  spaceId: string | undefined,
  decision: Extract<Decision, { ok: false }>,
): Promise<void> {
  if (decision.code !== 'not_space_member' || spaceId === undefined) {
    await sendProblem(reply, decision.code);
    return;
  }
  // A részletek csak elutasításkor kérdeződnek; ha közben a színtér eltűnt, a nem tag sem tud róla semmit: 404.
  const details = await access.denialDetails(actor, spaceId);
  if (details === undefined) {
    await sendProblem(reply, 'not_found');
    return;
  }
  await sendProblem(reply, 'not_space_member', { details: { ...details } });
}

export async function authorizeSpace(
  access: AccessStore,
  request: FastifyRequest,
  reply: FastifyReply,
  action: SpaceAction,
  spaceId: string,
): Promise<SpaceTarget | undefined> {
  const actor = actorOf(request);
  const target = await access.spaceTarget(actor.userId, spaceId);
  if (target === undefined) {
    await sendProblem(reply, 'not_found');
    return undefined;
  }
  const decision = can(actor, action, target);
  if (decision.ok) return target;
  await sendDenial(access, reply, actor, spaceId, decision);
  return undefined;
}

/**
 * Egy már betöltött színtér-célpont második döntése (pl. a `PATCH`-ben a név külön `space.rename` jog): nincs újabb
 * lekérdezés. `true`: engedett; `false`: a hibaválasz már elment.
 */
export async function authorizeLoadedSpace(
  access: AccessStore,
  request: FastifyRequest,
  reply: FastifyReply,
  action: SpaceAction,
  target: SpaceTarget,
): Promise<boolean> {
  const actor = actorOf(request);
  const decision = can(actor, action, target);
  if (decision.ok) return true;
  await sendDenial(access, reply, actor, target.spaceId, decision);
  return false;
}

export async function authorizeDocument(
  access: AccessStore,
  request: FastifyRequest,
  reply: FastifyReply,
  action: DocumentAction,
  documentId: string,
): Promise<DocumentTarget | undefined> {
  const actor = actorOf(request);
  const target = await access.documentTarget(actor.userId, documentId);
  if (target === undefined) {
    await sendProblem(reply, 'not_found');
    return undefined;
  }
  const decision = can(actor, action, target);
  if (decision.ok) return target;
  await sendDenial(access, reply, actor, target.space.spaceId, decision);
  return undefined;
}

/** Rendszerszintű műveletek: nincs betöltés. */
export async function authorizeSystem(
  request: FastifyRequest,
  reply: FastifyReply,
  action: SystemAction,
): Promise<boolean> {
  const decision = can(actorOf(request), action);
  if (decision.ok) return true;
  await sendProblem(reply, decision.code);
  return false;
}
