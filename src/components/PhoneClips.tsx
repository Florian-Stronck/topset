"use client";

import type { ClipView } from "@/lib/athlete-videos";
import { t } from "@/lib/i18n";

/** On the coach's phone: the videos the athlete sent for an exercise, played from storage. */
export function PhoneClips({ clips }: { clips: ClipView[] }) {
  if (clips.length === 0) return <div className="text-[11px] text-muted-2">{t("No videos.")}</div>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {clips.map((clip) => (
        <figure key={clip.id} className="min-w-0">
          <video src={`${clip.url}#t=0.1`} controls preload="metadata" playsInline className="aspect-[9/16] w-full rounded-lg bg-black object-contain" />
          <figcaption className="mt-0.5 text-[10px] text-muted-2">{clip.setIndex === null ? t("Set ?") : t("Set {n}", { n: clip.setIndex + 1 })}</figcaption>
        </figure>
      ))}
    </div>
  );
}
