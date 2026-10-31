/** What a coach an athlete is shared with may do, weakest first (see `AthleteShare`). */
export const ROLES = ["view", "review", "edit"] as const;
export type Role = (typeof ROLES)[number];

/** How a share reads in a list; through `t()`. */
export const ROLE_LABEL: Record<Role, string> = { view: "Can view", review: "Can review", edit: "Can edit" };

export function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}
