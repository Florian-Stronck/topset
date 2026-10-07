/** What a coach an athlete is shared with may do, weakest first (see `AthleteShare`). */
export const ROLES = ["view", "review", "edit"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}
