import { prisma } from "@/lib/prisma";
import { readConfig } from "@/lib/sync";

/**
 * Picks this copy's own coach out of the local Coach rows: the signed-in one, once
 * teammates' rows are here too. Signed out, or before the first sync gives the local coach
 * the account's id, the only coach there is.
 */
export async function myCoach(): Promise<{ id?: string }> {
  const id = readConfig()?.coachId;
  if (id && (await prisma.coach.count({ where: { id } }))) return { id };
  return {};
}
