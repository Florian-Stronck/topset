import { inviteCode } from "@/lib/auth";
import { body, json, withCoach } from "@/lib/coach-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const VALID_DAYS = 14;

/** For the admin: invite codes not used yet. */
export async function GET(request: Request) {
  return withCoach(
    request,
    async () => {
      const invites = await prisma.invite.findMany({
        where: { usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: { code: true, note: true, expiresAt: true },
      });
      return json({ ok: true, invites });
    },
    { admin: true },
  );
}

/** For the admin: withdraws an invite code nobody has used yet. */
export async function DELETE(request: Request) {
  return withCoach(
    request,
    async () => {
      const code = new URL(request.url).searchParams.get("code") ?? "";
      await prisma.invite.deleteMany({ where: { code, usedAt: null } });
      return json({ ok: true });
    },
    { admin: true },
  );
}

/** For the admin: a new invite code, good for one account within two weeks. */
export async function POST(request: Request) {
  return withCoach(
    request,
    async () => {
      const input = await body<{ note?: string }>(request, 10_000);
      const invite = await prisma.invite.create({
        data: {
          code: inviteCode(),
          note: String(input?.note ?? "").trim().slice(0, 120) || null,
          expiresAt: new Date(Date.now() + VALID_DAYS * 24 * 60 * 60 * 1000),
        },
        select: { code: true, note: true, expiresAt: true },
      });
      return json({ ok: true, invite });
    },
    { admin: true },
  );
}
