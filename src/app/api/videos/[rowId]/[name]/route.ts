import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { assertCoach } from "@/lib/role";
import { VIDEO_TYPES, videoPath } from "@/lib/videos";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ rowId: string; name: string }> };

/**
 * Plays a video. Answers byte ranges, which is what lets the player seek and start
 * before the whole file has been read.
 */
export async function GET(request: Request, { params }: Params) {
  assertCoach();
  const { rowId, name } = await params;
  const file = videoPath(rowId, decodeURIComponent(name));
  if (!file) return new NextResponse(null, { status: 404 });

  const { size } = fs.statSync(file);
  const type = VIDEO_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };

  if (!range) {
    const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
    return new NextResponse(stream, { headers: { ...headers, "Content-Length": String(size) } });
  }

  let start = range[1] === "" ? size - Number(range[2]) : Number(range[1]);
  let end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });

  const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
  return new NextResponse(stream, {
    status: 206,
    headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
  });
}

/**
 * `?do=open` opens the video in the computer's own player, for formats the built-in one
 * can't play; `?do=show` shows it in its folder. Desktop only.
 */
export async function POST(request: Request, { params }: Params) {
  assertCoach();
  if (process.platform !== "win32") return NextResponse.json({ ok: false }, { status: 400 });
  const { rowId, name } = await params;
  const file = videoPath(rowId, decodeURIComponent(name));
  if (!file) return new NextResponse(null, { status: 404 });
  const action = new URL(request.url).searchParams.get("do");
  // An argument list, never a command line: the path can't be read as anything else.
  const args = action === "show" ? [`/select,${file}`] : [file];
  spawn("explorer.exe", args, { detached: true, stdio: "ignore" }).unref();
  return NextResponse.json({ ok: true });
}
