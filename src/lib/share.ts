import { isRole, type Role } from "@/lib/roles";

export type AthleteShareInfo = {
  /** What this coach may do: "own" for their own athletes. */
  role: Role | "own";
  /** The coach who added the athlete. */
  owner: string;
  /** This coach, to leave an athlete shared with them. */
  me: string;
  /** How many other coaches the athlete is shared with. */
  count: number;
};

export function shareOf(a: { coachId: string; shares: { coachId: string; role: string }[]; coach: { name: string } }, me: string): AthleteShareInfo {
  const role = a.shares.find((s) => s.coachId === me)?.role;
  return { role: a.coachId === me ? "own" : isRole(role) ? role : "view", owner: a.coach.name, me, count: a.shares.length };
}

/** Whether this coach may change the athlete's plan and details, not just look (and maybe review). */
export const canEdit = (share: AthleteShareInfo) => share.role === "own" || share.role === "edit";
