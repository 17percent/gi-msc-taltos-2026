import type { SpaceRole, SpaceType, SystemRole } from '@taltos/shared';

export type CapabilityInput = {
  systemRole: SystemRole;
  /** A hívó szerepe ebben a színtérben; `null`, ha nem tag. */
  myRole: SpaceRole | null;
  space: { type: SpaceType; closed: boolean };
};

export type SpaceCapabilities = {
  editName: boolean;
  editDescriptionAndColor: boolean;
  addMembers: boolean;
  changeRoles: boolean;
  removeMembers: boolean;
  selfAssign: boolean;
  /** A beállítások semmilyen mezője nem szerkeszthető. */
  readOnly: boolean;
};

/**
 * A spec 4.1 táblázata: a felület elrejti, amit a hívó nem tehet meg. Ez csak megjelenítés:
 * a backend `can()` minden hívásnál újra dönt, és a hibát a felület ugyanúgy kezeli.
 */
export function spaceCapabilities({
  systemRole,
  myRole,
  space,
}: CapabilityInput): SpaceCapabilities {
  const isAdmin = systemRole === 'system_admin';
  const isManager = myRole === 'space_manager';
  const open = !space.closed;

  const editDescriptionAndColor = (isManager || isAdmin) && open;
  const editName = isAdmin && open;
  // Lezárt térben a tagságot csak a Rendszeradmin kezelheti (D56).
  const manageMembers = (isManager && open) || isAdmin;

  return {
    editName,
    editDescriptionAndColor,
    addMembers: manageMembers,
    changeRoles: manageMembers,
    removeMembers: manageMembers && space.type !== 'general',
    selfAssign: isAdmin && myRole === null,
    readOnly: !editName && !editDescriptionAndColor,
  };
}
