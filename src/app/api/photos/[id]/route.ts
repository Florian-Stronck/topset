import fs from "node:fs";
import { NextResponse } from "next/server";
import { photoFile, safePhotoId } from "@/lib/photos";
import { assertCoach } from "@/lib/role";

export const dynamic = "force-dynamic";

/** A check-in photo this computer has a copy of. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  assertCoach();
  const { id } = await params;
  if (!safePhotoId(id)) return new NextResponse(null, { status: 404 });
  const file = photoFile(id);
  if (!fs.existsSync(file)) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
