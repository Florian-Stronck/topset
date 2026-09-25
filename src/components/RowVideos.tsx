"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { plural, t } from "@/lib/i18n";
import type { VideoFile } from "@/lib/videos";

const base = (rowId: string) => `/api/videos/${encodeURIComponent(rowId)}`;
const fileUrl = (rowId: string, name: string) => `${base(rowId)}/${encodeURIComponent(name)}`;

function sizeText(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** Streams one file up, reporting how far it got; resolves with an error message or null. */
function upload(rowId: string, file: File, onProgress: (share: number) => void): Promise<string | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", base(rowId));
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { ok: boolean; error?: string };
        resolve(body.ok ? null : (body.error ?? "Upload failed."));
      } catch {
        resolve("Upload failed.");
      }
    };
    xhr.onerror = () => resolve("Upload failed.");
    xhr.send(file);
  });
}

/** How many preview frames fit in the field before the rest become "+n". */
const SHOWN = 3;

/**
 * The videos an athlete sent for one exercise, kept on this computer only: a field on the
 * row with a preview frame of each, and room to drop more. A frame opens its video; the
 * rest of the field opens the list to add one.
 */
export function RowVideos({ rowId, exercise, videos }: { rowId: string; exercise: string; videos: VideoFile[] }) {
  const [open, setOpen] = useState<{ play: string | null; files: File[] | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const shown = videos.slice(-SHOWN);
  const hidden = videos.length - shown.length;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen({ play: null, files: null })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen({ play: null, files: null });
          }
        }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) setOpen({ play: null, files: [...e.dataTransfer.files] });
        }}
        title={
          videos.length
            ? plural(videos.length, "{n} video — click to watch, or drop more here", "{n} videos — click to watch, or drop more here")
            : t("Attach a video — click, or drop one here")
        }
        className={`flex h-[38px] cursor-pointer items-center gap-1 rounded-md border px-1 outline-none focus-visible:ring-1 focus-visible:ring-accent ${
          dragging
            ? "border-accent bg-accent-soft"
            : videos.length
              ? "border-border bg-surface-2 hover:border-accent/60"
              : "border-dashed border-border hover:border-accent/60"
        }`}
      >
        {shown.map((v) => (
          <button
            key={v.name}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen({ play: v.name, files: null });
            }}
            title={v.name}
            className="relative h-[30px] w-[48px] shrink-0 overflow-hidden rounded bg-black ring-accent hover:ring-1"
          >
            <Thumbnail rowId={rowId} name={v.name} />
          </button>
        ))}
        {hidden > 0 && <span className="shrink-0 px-0.5 text-[11px] text-muted">+{hidden}</span>}
        <span
          className={`flex min-w-0 flex-1 items-center justify-center gap-1 text-[11px] ${
            dragging ? "text-accent" : "text-muted-2"
          }`}
        >
          {videos.length === 0 ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 10l5-3v10l-5-3M3 7h12v10H3z" />
              </svg>
              <span className="truncate">{dragging ? t("Drop to add") : t("Drop video")}</span>
            </>
          ) : (
            <span className="text-[14px] leading-none">+</span>
          )}
        </span>
      </div>
      {open && (
        <VideoDialog
          rowId={rowId}
          exercise={exercise}
          initialFiles={open.files}
          initialPlaying={open.play}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/**
 * A still of the video, taken by the browser itself: the player is asked for a frame just
 * in (#t=), loading no more than it needs. A format it can't play shows a plain icon.
 */
function Thumbnail({ rowId, name }: { rowId: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="grid h-full w-full place-items-center text-muted-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 10l5-3v10l-5-3M3 7h12v10H3z" />
        </svg>
      </span>
    );
  }
  return (
    <>
      <video
        src={`${fileUrl(rowId, name)}#t=0.5`}
        preload="metadata"
        muted
        playsInline
        tabIndex={-1}
        onError={() => setFailed(true)}
        className="pointer-events-none h-full w-full object-cover"
      />
      <span className="pointer-events-none absolute inset-0 grid place-items-center">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="white" className="opacity-80 drop-shadow" aria-hidden>
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </>
  );
}

function VideoDialog({
  rowId,
  exercise,
  initialFiles,
  initialPlaying,
  onClose,
}: {
  rowId: string;
  exercise: string;
  initialFiles: File[] | null;
  initialPlaying: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [videos, setVideos] = useState<VideoFile[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(initialPlaying);
  const [progress, setProgress] = useState<{ name: string; share: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const changed = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(base(rowId), { cache: "no-store" });
    const { videos: list } = (await res.json()) as { videos: VideoFile[] };
    setVideos(list);
    return list;
  }, [rowId]);

  const add = useCallback(
    async (files: File[]) => {
      setError(null);
      let last: string | null = null;
      for (const file of files) {
        setProgress({ name: file.name, share: 0 });
        const problem = await upload(rowId, file, (share) => setProgress({ name: file.name, share }));
        if (problem) setError(`${file.name}: ${t(problem)}`);
        else {
          changed.current = true;
          last = file.name;
        }
      }
      setProgress(null);
      const list = await load();
      // Straight to the newest one that went in.
      if (last) setPlaying(list.at(-1)?.name ?? null);
    },
    [rowId, load],
  );

  useEffect(() => {
    let live = true;
    fetch(base(rowId), { cache: "no-store" })
      .then((res) => res.json() as Promise<{ videos: VideoFile[] }>)
      .then(({ videos: list }) => {
        if (!live) return;
        setVideos(list);
        // Opens on the newest; files dropped on the row choose for themselves once added.
        if (!initialFiles?.length) setPlaying((p) => p ?? list.at(-1)?.name ?? null);
      });
    if (initialFiles?.length && !started.current) {
      started.current = true;
      void Promise.resolve().then(() => add(initialFiles));
    }
    return () => {
      live = false;
    };
  }, [rowId, add, initialFiles]);

  function close() {
    if (changed.current) router.refresh();
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function remove(name: string) {
    if (!window.confirm(t("Delete “{name}” from this computer?", { name }))) return;
    await fetch(`${base(rowId)}?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    changed.current = true;
    if (playing === name) setPlaying(null);
    await load();
  }

  const act = (name: string, what: "open" | "show") =>
    void fetch(`${fileUrl(rowId, name)}?do=${what}`, { method: "POST" });

  return createPortal(
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/60 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void add([...e.dataTransfer.files]);
      }}
    >
      <div className="flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/60">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">{exercise}</div>
            <div className="text-[11px] text-muted-2">{t("Kept on this computer only: not synced, not in backups.")}</div>
          </div>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={progress !== null}
            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {t("Add video…")}
          </button>
          <button type="button" onClick={close} aria-label={t("Close")} className="px-1 text-[18px] text-muted hover:text-foreground">
            ×
          </button>
          <input
            ref={input}
            type="file"
            accept="video/*,.mov,.mkv,.avi"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) void add(files);
            }}
          />
        </div>

        {progress && (
          <div className="border-b border-border px-4 py-2 text-[12px] text-muted">
            {t("Adding {name}…", { name: progress.name })}
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-accent" style={{ width: `${Math.round(progress.share * 100)}%` }} />
            </div>
          </div>
        )}
        {error && <div className="border-b border-border px-4 py-2 text-[12px] text-accent">{error}</div>}

        <div className="min-h-0 flex-1 overflow-auto">
          {playing && (
            <div className="bg-black">
              {broken.has(playing) ? (
                <div className="grid h-[300px] place-items-center px-6 text-center text-[13px] text-muted">
                  <div>
                    {t("This video's format can't play inside Topset.")}
                    <button type="button" onClick={() => act(playing, "open")} className="ml-2 text-accent">
                      {t("Open in your video player")}
                    </button>
                  </div>
                </div>
              ) : (
                <video
                  key={playing}
                  src={fileUrl(rowId, playing)}
                  controls
                  autoPlay
                  playsInline
                  onError={() => setBroken((b) => new Set(b).add(playing))}
                  className="mx-auto max-h-[60vh] w-full"
                />
              )}
            </div>
          )}

          {videos === null ? (
            <div className="px-4 py-6 text-center text-[12px] text-muted-2">{t("Loading…")}</div>
          ) : videos.length === 0 && !progress ? (
            <div className="px-4 py-10 text-center text-[13px] text-muted">
              {t("No videos yet. Drop the ones your athlete sent you here, or use Add video.")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {videos.map((v) => (
                <li key={v.name} className={`flex items-center gap-3 px-4 py-2 ${playing === v.name ? "bg-surface-2" : ""}`}>
                  <button type="button" onClick={() => setPlaying(v.name)} className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-accent">
                    {v.name}
                  </button>
                  <span className="shrink-0 text-[11px] text-muted-2">
                    {new Date(v.addedAt).toLocaleDateString()} · {sizeText(v.size)}
                  </span>
                  <button type="button" onClick={() => act(v.name, "show")} className="shrink-0 text-[11px] text-muted hover:text-foreground">
                    {t("Show in folder")}
                  </button>
                  <button type="button" onClick={() => void remove(v.name)} className="shrink-0 text-[11px] text-muted-2 hover:text-accent">
                    {t("Delete")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
