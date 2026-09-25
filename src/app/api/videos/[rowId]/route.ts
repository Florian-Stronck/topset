import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { assertCoach } from "@/lib/role";
import { deleteVideo, listVideos, newVideoPath, safeRowId } from "@/lib/videos";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ rowId: string }> };

/** The videos attached to one exercise row. */
export async function GET(_request: Request, { params }: Params) {
  assertCoach();
  const { rowId } = await params;
  if (!safeRowId(rowId)) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ videos: listVideos(rowId) });
}

/**
 * Adds a video. The file is the request body, streamed straight to disk so a long clip
 * never sits in memory; its name comes in the X-File-Name header.
 */
export async function POST(request: Request, { params }: Params) {
  assertCoach();
  const { rowId } = await params;
  const name = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  if (!safeRowId(rowId) || !request.body) return NextResponse.json({ ok: false, error: "Nothing to add." }, { status: 400 });
  const file = newVideoPath(rowId, name);
  if (!file) return NextResponse.json({ ok: false, error: "That isn't a video file Topset knows." }, { status: 400 });

  const partial = `${file}.part`;
  try {
    await pipeline(Readable.fromWeb(request.body as unknown as WebReadableStream), fs.createWriteStream(partial));
    fs.renameSync(partial, file);
  } catch {
    fs.rmSync(partial, { force: true });
    return NextResponse.json({ ok: false, error: "The upload stopped part way." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, name: path.basename(file) });
}

/** Deletes one video from this computer (`?name=`). */
export async function DELETE(request: Request, { params }: Params) {
  assertCoach();
  const { rowId } = await params;
  const name = new URL(request.url).searchParams.get("name") ?? "";
  return NextResponse.json({ ok: deleteVideo(rowId, name) });
}
