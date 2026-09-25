import { assertCoach } from "@/lib/role";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg"];

/**
 * The coach's logo lives in their settings like everything else, but it is served and
 * uploaded here: at up to 2 MB it has no business travelling with every page's settings.
 */
async function coach() {
  const row = await prisma.coach.findFirstOrThrow({ select: { id: true, settings: true } });
  let stored: { branding?: { logo?: string | null } } & Record<string, unknown> = {};
  try {
    stored = JSON.parse(row.settings);
  } catch {}
  return { id: row.id, stored };
}

export async function GET() {
  assertCoach();
  const { stored } = await coach();
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(stored.branding?.logo ?? "");
  if (!m) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(Buffer.from(m[2], "base64")), {
    headers: { "Content-Type": m[1], "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  assertCoach();
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!TYPES.includes(type)) {
    return NextResponse.json({ ok: false, error: "PNG or JPEG." }, { status: 400 });
  }
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "Pick an image under 2 MB." }, { status: 400 });
  }
  const { id, stored } = await coach();
  stored.branding = { ...(stored.branding ?? {}), logo: `data:${type};base64,${bytes.toString("base64")}` };
  await prisma.coach.update({ where: { id }, data: { settings: JSON.stringify(stored) } });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  assertCoach();
  const { id, stored } = await coach();
  if (stored.branding) stored.branding.logo = null;
  await prisma.coach.update({ where: { id }, data: { settings: JSON.stringify(stored) } });
  return NextResponse.json({ ok: true });
}
