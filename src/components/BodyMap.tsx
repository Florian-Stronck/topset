"use client";

import Body, { type ExtendedBodyPart, type Slug } from "react-muscle-highlighter";
import { t } from "@/lib/i18n";
import { AREAS, areaOf, areasIn, injuryLabel, regionMarks, type AreaId, type Side } from "@/lib/injuries";

/**
 * The body from the front and the back (react-muscle-highlighter's anatomy, MIT), each
 * region a place to tap. The figure is drawn face on, so on the front the athlete's right
 * is on the viewer's left, and on the back it is the other way round. Sore regions fill by
 * how bad the worst injury there is.
 */

/** Every region the areas are drawn on. */
const REGIONS = [...new Set(AREAS.map((a) => a.region))] as Slug[];

/** The spot a form is about. */
const PICKED_FILL = "#5b8def";

/** 1 a niggle … 5 can't train it: amber to deep red. */
const SEVERITY_FILL = ["#f0b43c", "#f08c3c", "#ee6a4a", "#e2403f", "#b3261e"];

/** The package's own sides are the viewer's; ours are the athlete's. */
function athleteSide(view: "front" | "back", screen: "left" | "right" | undefined): Side | null {
  if (!screen) return null;
  const left = screen === "left";
  return view === "front" ? (left ? "R" : "L") : left ? "L" : "R";
}

function screenSide(view: "front" | "back", side: Side | null): "left" | "right" | undefined {
  if (!side) return undefined;
  return view === "front" ? (side === "R" ? "left" : "right") : side === "L" ? "left" : "right";
}

export function BodyMap({
  marks,
  picked,
  onPick,
  height = 260,
}: {
  /** Where it hurts now, and how badly (1–5). */
  marks: { area: string; side: Side | null; severity: number }[];
  /** The area chosen in a form, shown in blue. */
  picked?: { area: string; side: Side | null } | null;
  /** Makes the map tappable; the area is the region's first, the form offers the rest. */
  onPick?: (area: AreaId, side: Side | null) => void;
  height?: number;
}) {
  const sore = regionMarks(marks);
  const pickedArea = picked ? areaOf(picked.area) : undefined;

  const view = (which: "front" | "back") => {
    // Every region in the theme's colour — the package paints its own grey otherwise —
    // then the sore ones over it.
    const data: ExtendedBodyPart[] = REGIONS.map((region) => {
      const m = sore.find((s) => s.region === region);
      return m
        ? { slug: region, side: screenSide(which, m.side), styles: { fill: SEVERITY_FILL[Math.min(5, Math.max(1, m.severity)) - 1] } }
        : { slug: region, styles: { fill: "currentColor" } };
    });
    if (pickedArea) {
      // The package styles a region's two sides alike, so the pick shows as a fill on its
      // side — over a sore region only when it's the one side that hurts.
      const held = data.find((d) => d.slug === pickedArea.region)!;
      const sorest = sore.find((m) => m.region === pickedArea.region);
      if (!sorest || sorest.side === picked!.side) {
        Object.assign(held, { side: screenSide(which, picked!.side), styles: { fill: PICKED_FILL } });
      }
    }
    return (
      <figure className="flex flex-col items-center">
        <div className="text-muted-2 [&_svg]:!h-auto [&_svg]:!w-full" style={{ width: height / 2 }}>
          <Body
            data={data}
            side={which}
            border="none"
            defaultFill="currentColor"
            hiddenParts={["hair"]}
            onBodyPartPress={
              onPick
                ? (part, screen) => {
                    const first = part.slug ? areasIn(part.slug)[0] : undefined;
                    if (first) onPick(first.id, first.sided ? athleteSide(which, screen) : null);
                  }
                : undefined
            }
          />
        </div>
        <figcaption className="mt-1 text-[10px] tracking-[0.16em] text-muted-2">{which === "front" ? t("FRONT") : t("BACK")}</figcaption>
      </figure>
    );
  };

  return (
    <div>
      <div role="img" aria-label={t("Body map")} className="flex justify-center gap-4 [&_path]:transition-[fill] [&_path]:duration-150">
        {view("front")}
        {view("back")}
      </div>
      {onPick && (
        // The same choice for a keyboard, or for a spot too small to hit.
        <label className="mt-2 flex items-center justify-center gap-2 text-[12px] text-muted-2">
          {t("or pick")}
          <select
            value=""
            onChange={(e) => {
              const area = areaOf(e.target.value);
              if (area) onPick(area.id, area.sided ? "R" : null);
            }}
            className="rounded border border-border bg-surface-2 px-1.5 py-1 text-[12px] text-foreground outline-none focus:border-accent"
          >
            <option value="">{t("an area…")}</option>
            {AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {injuryLabel({ area: a.id, side: null })}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
