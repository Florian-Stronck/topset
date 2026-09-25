import { jsPDF } from "jspdf";
import { formatPrescription, maxesOf, resolveDay } from "@/lib/intensity";
import type { BlockWithDays } from "@/lib/queries";
import { WEEKDAYS } from "@/lib/types";
import { dayName } from "@/lib/days";
import { formatDate, weekdayOfDay } from "@/lib/dates";
import { brandBlockHeight, drawBrandBlock, footerText } from "@/lib/branding";
import { activeSettings, tierLabel } from "@/lib/settings";
import { t } from "@/lib/i18n";

// Phone-width page. Height is per-week: each page grows to fit its own week, so a
// week is never split across pages.
const W = 400;
const M = 20;
const CONTENT = W - M * 2;
const HEAD_H = 78;
const FOOT_H = 34;
const MIN_H = 320;
const MAX_H = 14400; // hard ceiling of the PDF format

const ACCENT: [number, number, number] = [229, 54, 90];
const INK: [number, number, number] = [23, 23, 27];
const MUTED: [number, number, number] = [125, 125, 135];
const RULE: [number, number, number] = [226, 226, 232];

// cp1252 characters above Latin-1 — the only ones jsPDF's built-in fonts can draw.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/**
 * jsPDF's built-in fonts only know Windows-1252; anything else comes out as garbage
 * ("−10%" printed as `"10%`). Swaps the characters the app itself writes, drops the rest.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/−/g, "-")
    .replace(/→/g, "›")
    .replace(/[^\x00-\xff]/g, (c) => (WIN_ANSI_EXTRA.has(c) ? c : "?"));
}

function weekDate(start: Date, week: number) {
  const d = new Date(start);
  d.setDate(d.getDate() + (week - 1) * 7);
  return formatDate(d, true);
}

type DayItem = { kind: "day"; label: string; weekday: string };
type ExerciseItem = {
  kind: "exercise";
  name: string;
  tier: string;
  target: string;
  sets: number | null;
  reps: number | null;
  prescription: string;
  weight: number | null;
  ramp: number[];
  notes: string[];
  /** Tempo and rest, when the coach exports them. */
  extra: string;
  video: string | null;
  actualWeight: number | null;
  performedRpe: number | null;
};
type Item = (DayItem | ExerciseItem) & { height: number };

function exerciseHeight(item: Omit<ExerciseItem, "kind">) {
  return (
    52 +
    item.notes.length * 11 +
    (item.ramp.length > 1 ? 13 : 0) +
    (item.extra ? 12 : 0) +
    (item.video ? 12 : 0)
  );
}

/** Lays a week out as a flat item list so its page can be sized before anything is drawn. */
function layoutWeek(doc: jsPDF, block: BlockWithDays, week: number): Item[] {
  const athlete = block.athlete;
  const maxes = maxesOf(block, athlete);
  const items: Item[] = [];

  const days = block.weeks.find((w) => w.order === week)?.days ?? [];

  for (const day of days) {
    if (day.rest && day.rows.length === 0) continue;

    items.push({ kind: "day", label: pdfSafe(dayName(day)), weekday: t(WEEKDAYS[weekdayOfDay(block.startDate, day.index)]), height: 20 });
    const resolvedDay = resolveDay(day.rows, maxes);

    // Unnamed rows are the grid's ghost slots, not prescriptions.
    for (const row of day.rows.filter((r) => r.exercise.trim() !== "")) {
      const cell = row;
      const resolved = resolvedDay.get(row.id) ?? null;

      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      const show = activeSettings().exportColumns;
      const notes =
        show.notes && cell?.coachNotes
          ? (doc.splitTextToSize(pdfSafe(cell.coachNotes), CONTENT - 16) as string[])
          : [];
      const extra = [
        show.tempo && row.tempo ? `${t("Tempo")} ${row.tempo}` : "",
        show.rest && row.restTime ? `${t("Rest")} ${row.restTime}` : "",
      ]
        .filter(Boolean)
        .join("   ·   ");

      const item = {
        name: pdfSafe(row.exercise),
        tier: pdfSafe(tierLabel(row.tier)),
        target: pdfSafe(row.target),
        extra: pdfSafe(extra),
        video: show.video && row.videoUrl ? row.videoUrl : null,
        sets: cell?.sets ?? null,
        reps: cell?.reps ?? null,
        prescription: cell ? pdfSafe(formatPrescription(cell, athlete.unit)) : "—",
        weight: resolved?.weight ?? null,
        ramp: resolved?.ramp ?? [],
        notes,
        actualWeight: cell?.actualWeight ?? null,
        performedRpe: cell?.performedRpe ?? null,
      };
      items.push({ kind: "exercise", ...item, height: exerciseHeight(item) });
    }

    items[items.length - 1].height += 8;
  }

  return items;
}

export function toPdf(block: BlockWithDays): Buffer {
  const unit = block.athlete.unit === "LB" ? "lb" : "kg";

  // A throwaway doc to measure text wrapping before the real pages are sized.
  const ruler = new jsPDF({ unit: "pt", format: [W, MIN_H], orientation: "portrait" });
  const weeks = block.weeks.map(({ order: week }) => {
    const items = layoutWeek(ruler, block, week);
    const content = items.reduce((sum, item) => sum + item.height, 0) + barHeight(ruler) - 58;
    const height = Math.min(MAX_H, Math.max(MIN_H, HEAD_H + content + FOOT_H));
    return { week, items, height };
  });

  const doc = new jsPDF({ unit: "pt", format: [W, weeks[0].height], orientation: "portrait" });

  weeks.forEach(({ week, items, height }, i) => {
    if (i > 0) doc.addPage([W, height], "portrait");
    let y = header(doc, block, week);

    for (const item of items) {
      y =
        item.kind === "day"
          ? dayHeading(doc, item.label, item.weekday, y)
          : exercise(doc, { ...item, y, unit });
    }
  });

  stampFooters(doc, block);
  return Buffer.from(doc.output("arraybuffer"));
}

/** Room left and right of the coach's block for "Week 1" and the date. */
const SIDE = 92;

/**
 * Height of the week's coloured bar: the usual 58, or taller when the coach's block
 * (logo, name, header line) needs the room.
 */
function barHeight(doc: jsPDF): number {
  const brand = brandBlockHeight(doc);
  return brand > 0 ? Math.max(58, brand + 26) : 58;
}

/**
 * The week's coloured bar: "Week 1" on the left, the date on the right, and the coach's
 * logo, name and header line centred between them; the program and athlete underneath.
 */
function header(doc: jsPDF, block: BlockWithDays, week: number): number {
  const bar = barHeight(doc);
  const brand = brandBlockHeight(doc);
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, W, bar, "F");

  // The top line sits level with the middle of the coach's block.
  const line = brand > 0 ? 12 + (brand - 10) / 2 + 5 : 26;
  if (brand > 0) {
    drawBrandBlock(doc, M + SIDE, 12, CONTENT - SIDE * 2, { ink: [255, 255, 255], muted: [255, 222, 230] }, pdfSafe);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(pdfSafe(t("Week {n}", { n: week })), M, line);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(weekDate(block.startDate, week), W - M, line, { align: "right" });
  doc.text(pdfSafe(`${block.program.name} · ${block.phase}`), M, bar - 16);
  doc.text(pdfSafe(block.athlete.name), W - M, bar - 16, { align: "right" });

  return bar + 20;
}

function dayHeading(doc: jsPDF, label: string, weekday: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ACCENT);
  doc.text(label, M, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(weekday, W - M, y, { align: "right" });

  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(1);
  doc.line(M, y + 5, W - M, y + 5);
  return y + 20;
}

function exercise(
  doc: jsPDF,
  o: {
    y: number;
    name: string;
    tier: string;
    target: string;
    sets: number | null;
    reps: number | null;
    prescription: string;
    weight: number | null;
    ramp: number[];
    unit: string;
    notes: string[];
    extra: string;
    video: string | null;
    actualWeight: number | null;
    performedRpe: number | null;
  },
): number {
  let y = o.y;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(...INK);
  doc.text(o.name, M, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(`${o.tier} · ${o.target}`, W - M, y, { align: "right" });
  y += 15;

  // The prescription always stays visible; the weight is what it resolves to today.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(`${o.sets ?? "—"} × ${o.reps ?? "—"}`, M, y);

  const volumeWidth = doc.getTextWidth(`${o.sets ?? "—"} × ${o.reps ?? "—"}`);
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(`@ ${o.prescription}`, M + volumeWidth + 8, y);

  if (o.weight !== null) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...INK);
    doc.text(`${o.weight} ${o.unit}`, W - M, y, { align: "right" });
  }
  y += 13;

  if (o.ramp.length > 1) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...ACCENT);
    doc.text(o.ramp.map((w, i) => (i === 0 ? `${w}` : `› ${w}`)).join("  "), M, y);
    y += 13;
  }

  if (o.extra) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(o.extra, M, y);
    y += 12;
  }

  if (o.video) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...ACCENT);
    doc.textWithLink(pdfSafe(t("Watch the video")), M, y, { url: o.video });
    y += 12;
  }

  if (o.notes.length > 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    for (const line of o.notes) {
      doc.text(line, M, y);
      y += 11;
    }
    y += 1;
  }

  // Logging strip: shows what the athlete did, or blanks to fill in.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const logged =
    o.actualWeight !== null || o.performedRpe !== null
      ? `${t("Logged")}  ${o.actualWeight ?? "—"} ${o.unit}   ·   RPE ${o.performedRpe ?? "—"}`
      : `${t("Logged")}  ______ ${o.unit}   ·   RPE ______`;
  doc.text(logged, M, y);
  y += 10;

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  return y + 14;
}

function stampFooters(doc: jsPDF, block: BlockWithDays) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const bottom = doc.internal.pageSize.getHeight() - 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const brand = activeSettings().branding.name.trim();
    doc.text(pdfSafe([brand, block.athlete.name].filter(Boolean).join(" · ")), M, bottom);
    const note = footerText();
    if (note) doc.text(pdfSafe(note), W / 2, bottom, { align: "center", maxWidth: W / 2 - M });
    doc.text(`${i} / ${pages}`, W - M, bottom, { align: "right" });
  }
}
