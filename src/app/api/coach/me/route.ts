import { json, withCoach } from "@/lib/coach-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withCoach(request, async ({ id, name, username, isAdmin }) => json({ ok: true, coach: { id, name, username, isAdmin } }));
}
