import { assertCoach } from "@/lib/role";
import { NextResponse } from "next/server";
import { snapshot, stageRestore } from "@/lib/backup";
import { loadSettings } from "@/lib/coach-settings";

export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

/** The whole database as one file, to keep somewhere safe. */
export async function GET() {
  assertCoach();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const [bytes, settings] = [snapshot(), await loadSettings()];
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="topset-backup-${stamp}.db"`,
      "Cache-Control": "no-store",
      // The desktop app's daily backup of the cloud database follows these.
      "X-Topset-Backup": JSON.stringify(settings.backup),
    },
  });
}

/** Stages an uploaded backup; the desktop app swaps it in on its next start. */
export async function POST(request: Request) {
  assertCoach();
  if (process.env.TOPSET_DESKTOP !== "1") {
    return NextResponse.json(
      { ok: false, error: "Restoring works in the desktop app only." },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "That file is empty or too large." }, { status: 400 });
  }

  const result = await stageRestore(bytes);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
