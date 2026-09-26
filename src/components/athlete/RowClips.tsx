"use client";

import { useRef, useState } from "react";
import { deleteClip, finishClip, setClipSet, startClip } from "@/app/a/actions";
import { MAX_CLIPS_PER_ROW, type ClipView } from "@/lib/athlete-videos";
import { plural, t } from "@/lib/i18n";
import { shrinkVideo } from "@/lib/shrink-video";

type Job = { name: string; stage: "shrink" | "upload" | "save"; share: number };

/** Sends a file to a signed storage link, reporting how much has gone. */
function put(url: string, file: File, contentType: string, onProgress: (share: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    // What storage said, so a setup problem can be told apart from a bad connection.
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      const code = /<Code>([^<]+)<\/Code>/.exec(xhr.responseText ?? "")?.[1];
      reject(Object.assign(new Error("The upload stopped part way."), { detail: `${xhr.status}${code ? ` ${code}` : ""}` }));
    };
    // Status 0: the browser stopped it, most often the bucket's CORS policy, or the network.
    xhr.onerror = () => reject(Object.assign(new Error("The upload stopped part way."), { detail: "blocked: CORS or connection" }));
    xhr.send(file);
  });
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/**
 * An exercise's videos in the athlete app: a button beside the note to film or pick one,
 * and a strip of stills to play, save to the phone or delete. Each goes up shrunk to 720p, straight to
 * storage, while the athlete carries on logging.
 */
export function RowClips({
  token,
  rowId,
  day,
  initial,
  note,
  sets,
  guessSet,
}: {
  token: string;
  rowId: string;
  day: string;
  initial: ClipView[];
  /** How many sets the exercise has on screen, to pick which one a video shows. */
  sets: number;
  /** The set a new video most likely shows: the last one ticked off. */
  guessSet: () => number | null;
  /** The exercise's note field, which shares its line with the video button. */
  note: React.ReactNode;
}) {
  const [clips, setClips] = useState(initial);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playing = clips.find((c) => c.id === playingId) ?? null;
  const input = useRef<HTMLInputElement>(null);
  // The phone's own full-quality file for what was sent from here, for "Save to phone".
  const originals = useRef(new Map<string, File>());

  async function send(files: File[]) {
    setError(null);
    for (const original of files) {
      try {
        setJob({ name: original.name, stage: "shrink", share: 0 });
        const { file } = await shrinkVideo(original, (share) => setJob({ name: original.name, stage: "shrink", share }));
        setJob({ name: original.name, stage: "upload", share: 0 });
        const start = await startClip(token, rowId, day, { name: original.name, type: file.type, size: file.size }, guessSet());
        if (!start.ok) throw new Error(start.error);
        await put(start.value.url, file, start.value.contentType, (share) => setJob({ name: original.name, stage: "upload", share }));
        setJob({ name: original.name, stage: "save", share: 1 });
        const done = await finishClip(token, start.value.id);
        if (!done.ok) throw new Error(done.error);
        originals.current.set(done.value.id, original);
        setClips((was) => [...was, done.value]);
      } catch (e) {
        const detail = (e as { detail?: string }).detail;
        setError(e instanceof Error ? `${t(e.message)}${detail ? ` (${detail})` : ""}` : t("Couldn't save. Check your connection and try again."));
        break;
      }
    }
    setJob(null);
  }

  async function remove(clip: ClipView) {
    setPlayingId(null);
    setClips((was) => was.filter((c) => c.id !== clip.id));
    try {
      await deleteClip(token, clip.id);
    } catch {
      setClips((was) => [...was, clip].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)));
      setError(t("Couldn't save. Check your connection and try again."));
    }
  }

  function fileUnder(clip: ClipView, setIndex: number | null) {
    setClips((was) => was.map((c) => (c.id === clip.id ? { ...c, setIndex } : c)));
    setClipSet(token, clip.id, setIndex).catch(() => {
      setClips((was) => was.map((c) => (c.id === clip.id ? { ...c, setIndex: clip.setIndex } : c)));
      setError(t("Couldn't save. Check your connection and try again."));
    });
  }

  const full = clips.length >= MAX_CLIPS_PER_ROW;

  return (
    <div>
      {/* The note takes three quarters of the line, the video button the last quarter. */}
      <div className="grid grid-cols-[3fr_1fr] gap-2">
        {note}
        <button
          type="button"
          disabled={job !== null || full}
          onClick={() => input.current?.click()}
          aria-label={t("Add video")}
          className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border px-1 text-center text-[11px] leading-tight text-muted active:bg-surface-3 disabled:opacity-60"
        >
          {job ? (
            <>
              <span className="text-[15px] font-semibold tabular-nums text-foreground">{Math.round(job.share * 100)}%</span>
              <span>{job.stage === "shrink" ? t("Shrinking") : job.stage === "upload" ? t("Uploading") : t("Saving")}</span>
            </>
          ) : (
            <>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 10l4.5-2.5v9L15 14M4 7h11v10H4z" />
              </svg>
              {full ? `${clips.length}/${MAX_CLIPS_PER_ROW}` : t("Add video")}
            </>
          )}
        </button>
      </div>

      {clips.length > 0 && (
        <>
          <div className="mb-2 mt-3 flex items-baseline justify-between text-[11px] tracking-[0.14em] text-muted">
            <span>{t("VIDEOS")}</span>
            <span className="tracking-normal text-muted-2">{t("Kept for {n} days", { n: Math.max(...clips.map((c) => c.daysLeft)) })}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {clips.map((clip) => (
              <button
                key={clip.id}
                type="button"
                onClick={() => setPlayingId(clip.id)}
                aria-label={t("Play {name}", { name: clip.name })}
                className="relative h-24 w-[72px] shrink-0 overflow-hidden rounded-xl border border-border bg-surface-3"
              >
                <video src={`${clip.url}#t=0.1`} preload="metadata" muted playsInline className="pointer-events-none h-full w-full object-cover" />
                <span className="absolute inset-0 grid place-items-center">
                  <span className="grid size-7 place-items-center rounded-full bg-black/55 text-white">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </span>
                <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[10px] font-medium text-white">
                  {clip.setIndex === null ? t("Set ?") : t("Set {n}", { n: clip.setIndex + 1 })}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <input
        ref={input}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void send(files.slice(0, MAX_CLIPS_PER_ROW - clips.length));
        }}
      />

      {error && <p className="mt-2 text-[12px] text-miss">{error}</p>}
      {clips.length === 0 && !job && (
        <p className="mt-2 text-[12px] leading-snug text-muted-2">{t("Film with your camera app, then add it here: the full-quality original stays in your photos.")}</p>
      )}

      {playing && (
        <Player
          clip={playing}
          original={() => originals.current.get(playing.id) ?? null}
          sets={Math.max(sets, (playing.setIndex ?? -1) + 1)}
          onSet={(i) => fileUnder(playing, i)}
          onClose={() => setPlayingId(null)}
          onDelete={() => remove(playing)}
        />
      )}
    </div>
  );
}

/** A clip full screen, with saving it to the phone and deleting it. */
function Player({
  clip,
  original,
  sets,
  onSet,
  onClose,
  onDelete,
}: {
  clip: ClipView;
  /** The phone's own file, when it was sent from here this visit. */
  original: () => File | null;
  sets: number;
  onSet: (setIndex: number | null) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /** The share sheet where the phone has one ("Save Video" on an iPhone), a download otherwise. */
  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const file: File = original() ?? (await fetch(clip.url).then(async (r) => {
        if (!r.ok) throw new Error();
        const blob = await r.blob();
        return new File([blob], clip.name.replace(/\.[^.]*$/, "") + (blob.type === "video/quicktime" ? ".mov" : ".mp4"), { type: blob.type || "video/mp4" });
      }));
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] }).catch(() => {});
      } else {
        const href = URL.createObjectURL(file);
        const a = Object.assign(document.createElement("a"), { href, download: file.name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(href), 10_000);
      }
    } catch {
      setNote(t("Couldn't save. Check your connection and try again."));
    }
    setSaving(false);
  }

  return (
    <div role="dialog" aria-modal className="fixed inset-0 z-50 flex flex-col bg-black pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="min-w-0 truncate text-[13px] text-white/70">
          {clip.name} · {mb(clip.size)}
        </span>
        <button type="button" onClick={onClose} className="h-10 rounded-full px-3 text-[15px] font-medium">
          {t("Done")}
        </button>
      </div>
      <video src={clip.url} controls autoPlay playsInline className="min-h-0 w-full flex-1 bg-black object-contain" />
      <div className="flex items-center gap-1.5 overflow-x-auto px-4 pt-3" role="radiogroup" aria-label={t("Which set is this?")}>
        <span className="mr-1 shrink-0 text-[12px] text-white/60">{t("Set")}</span>
        {Array.from({ length: sets }, (_, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={clip.setIndex === i}
            onClick={() => onSet(clip.setIndex === i ? null : i)}
            className={`grid size-9 shrink-0 place-items-center rounded-full text-[14px] tabular-nums ${
              clip.setIndex === i ? "bg-white font-semibold text-black" : "bg-white/15 text-white"
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={save} disabled={saving} className="h-11 flex-1 rounded-full bg-white/15 text-[14px] font-medium text-white disabled:opacity-60">
          {saving ? t("Saving") : t("Save to phone")}
        </button>
        {confirming ? (
          <button type="button" onClick={onDelete} className="h-11 flex-1 rounded-full bg-miss text-[14px] font-semibold text-white">
            {t("Delete video")}
          </button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="h-11 rounded-full px-4 text-[14px] text-white/80">
            {t("Delete")}
          </button>
        )}
      </div>
      <p className="px-4 pb-3 text-center text-[12px] text-white/50">
        {note ?? plural(clip.daysLeft, "Your coach gets a copy. Kept here for {n} more day.", "Your coach gets a copy. Kept here for {n} more days.")}
      </p>
    </div>
  );
}
