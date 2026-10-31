"use client";

import { t } from "@/lib/i18n";

/** DOTS or IPF GL, for every meet score on the page. */
export function ScoreToggle({ scoring, onScoring }: { scoring: "dots" | "gl"; onScoring: (kind: "dots" | "gl") => void }) {
  return (
    <div role="group" aria-label={t("Score")} className="inline-flex overflow-hidden rounded-full border border-border text-[11.5px]">
      {(["dots", "gl"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={kind === scoring}
          onClick={() => kind !== scoring && onScoring(kind)}
          className={`px-2.5 py-0.5 ${kind === scoring ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-foreground"}`}
        >
          {kind === "gl" ? "GL" : "DOTS"}
        </button>
      ))}
    </div>
  );
}
