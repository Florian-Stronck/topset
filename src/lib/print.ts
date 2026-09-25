import { jsPDF } from "jspdf";
import { drawBrandBlock, footerText } from "@/lib/branding";
import { formatDate, weekdayOfDay } from "@/lib/dates";
import { dayName } from "@/lib/days";
import { formatPrescription, maxesOf, resolveDay } from "@/lib/intensity";
import { pdfSafe } from "@/lib/pdf";
import type { BlockWithDays } from "@/lib/queries";
import { activeSettings } from "@/lib/settings";
import { WEEKDAYS } from "@/lib/types";
import { t } from "@/lib/i18n";

// Built for paper: black on white, a table per day, and blank boxes the athlete fills
// in with a pen. Paper size, orientation and columns come from the coach's settings.
const PAPER = { A4: [595, 842], LETTER: [612, 792] } as const;
const M = 36;

const INK: [number, number, number] = [20, 20, 24];
const MUTED: [number, number, number] = [110, 110, 120];
const LINE: [number, number, number] = [200, 200, 208];
const SHADE: [number, number, number] = [240, 240, 244];

type ColKey = "exercise" | "volume" | "intensity" | "load" | "tempo" | "rest" | "notes" | "done";
type Col = { key: ColKey; title: string; weight: number; width: number };

const PAD = 4;
const LINE_H = 10.5;
const BOX = 11;
const BOX_GAP = 2;
const SET_GAP = 6;

function weekLabel(start: Date, week: number) {
  const from = new Date(start);
  from.setDate(from.getDate() + (week - 1) * 7);
  const to = new Date(from);
  to.setDate(to.getDate() + 6);
  return `${formatDate(from)} – ${formatDate(to)} ${to.getFullYear()}`;
}

/** The columns the coach wants, sized to fill the page width in proportion. */
function columnsFor(contentWidth: number): Col[] {
  const { exportColumns: show, logBoxes } = activeSettings();
  const cols: Omit<Col, "width">[] = [
    { key: "exercise", title: "Exercise", weight: 135 },
    { key: "volume", title: "Sets × Reps", weight: 62 },
    { key: "intensity", title: "Intensity", weight: 72 },
    { key: "load", title: "Load", weight: 62 },
  ];
  if (show.tempo) cols.push({ key: "tempo", title: "Tempo", weight: 44 });
  if (show.rest) cols.push({ key: "rest", title: "Rest", weight: 44 });
  if (show.notes) cols.push({ key: "notes", title: "Coach notes", weight: 102 });
  cols.push({ key: "done", title: "Done", weight: logBoxes > 0 ? 90 + logBoxes * 12 : 90 });
  const total = cols.reduce((s, c) => s + c.weight, 0);
  return cols.map((c) => ({ ...c, width: (c.weight / total) * contentWidth }));
}

/** Height the logging boxes need for `sets` sets inside a column `width` wide. */
function boxesHeight(sets: number, width: number): number {
  const per = activeSettings().logBoxes;
  if (per <= 0 || sets <= 0) return 0;
  const group = per * BOX + (per - 1) * BOX_GAP;
  const perLine = Math.max(1, Math.floor((width - PAD * 2 + SET_GAP) / (group + SET_GAP)));
  const lines = Math.ceil(sets / perLine);
  return lines * (BOX + 4) + PAD * 2;
}

/**
 * The printable sheet: one or more weeks of a phase, each starting on a fresh page.
 * Days never split across pages unless a single day is taller than a page.
 */
export function toPrintPdf(block: BlockWithDays, onlyWeek?: number): Buffer {
  const { paper, orientation, exportColumns } = activeSettings();
  const [pw, ph] = PAPER[paper] ?? PAPER.A4;
  const [W, H] = orientation === "landscape" ? [ph, pw] : [pw, ph];
  const bottom = H - M - 16;
  const COLS = columnsFor(W - M * 2);

  const doc = new jsPDF({ unit: "pt", format: [pw, ph], orientation });
  const unit = block.athlete.unit === "LB" ? "lb" : "kg";
  const maxes = maxesOf(block, block.athlete);
  const weeks = block.weeks.filter((w) => onlyWeek === undefined || w.order === onlyWeek);

  const head = (week: number) => header(doc, block, week, W);

  weeks.forEach((week, wi) => {
    if (wi > 0) doc.addPage([pw, ph], orientation);
    let y = head(week.order);

    for (const day of week.days) {
      const rows = day.rows.filter((r) => r.exercise.trim() !== "");
      if (rows.length === 0) continue;

      const resolved = resolveDay(day.rows, maxes);
      const cells = rows.map((row) => {
        const target = resolved.get(row.id);
        const ramp =
          target?.ramp && target.ramp.length > 1 ? `${target.ramp.join(" / ")} ${unit}` : null;
        const values: Record<ColKey, string> = {
          exercise: pdfSafe(row.exercise),
          volume: `${row.sets ?? "—"} × ${row.reps ?? "—"}`,
          intensity: pdfSafe(formatPrescription(row, block.athlete.unit)),
          load: ramp ?? (target?.weight != null ? `${target.weight} ${unit}` : ""),
          tempo: pdfSafe(row.tempo ?? ""),
          rest: pdfSafe(row.restTime ?? ""),
          notes: pdfSafe(
            [row.coachNotes ?? "", exportColumns.video && row.videoUrl ? row.videoUrl : ""]
              .filter(Boolean)
              .join("\n"),
          ),
          done: "",
        };
        return { values, sets: row.sets ?? 0 };
      });

      // Measure first so a day can move to the next page whole.
      doc.setFontSize(9);
      const doneCol = COLS.find((c) => c.key === "done")!;
      const heights = cells.map((c) =>
        Math.max(
          22,
          boxesHeight(c.sets, doneCol.width),
          ...COLS.map(
            (col) =>
              (doc.splitTextToSize(c.values[col.key], col.width - PAD * 2) as string[]).length *
                LINE_H +
              PAD * 2,
          ),
        ),
      );
      const dayHeight = 20 + 18 + heights.reduce((a, b) => a + b, 0) + 12;

      if (y + dayHeight > bottom && y > 120) {
        doc.addPage([pw, ph], orientation);
        y = head(week.order);
      }

      y = dayTitle(
        doc,
        pdfSafe(`${t(WEEKDAYS[weekdayOfDay(block.startDate, day.index)])} — ${dayName(day)}`),
        y,
      );
      y = tableHead(doc, COLS, y);

      cells.forEach((c, i) => {
        if (y + heights[i] > bottom) {
          doc.addPage([pw, ph], orientation);
          y = head(week.order);
          y = tableHead(doc, COLS, y);
        }
        y = tableRow(doc, COLS, c.values, c.sets, heights[i], y);
      });
      y += 12;
    }
  });

  footers(doc, block, W, H);
  return Buffer.from(doc.output("arraybuffer"));
}

function header(doc: jsPDF, block: BlockWithDays, week: number, W: number): number {
  // The coach's block, centred above the week's heading.
  const brand = drawBrandBlock(doc, M, M - 14, W - M * 2, { ink: INK, muted: MUTED }, pdfSafe);
  const top = brand === M - 14 ? M : brand;

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(pdfSafe(t("Week {n}", { n: week })), M, top + 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(pdfSafe(block.athlete.name), W - M, top + 12, { align: "right" });

  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(pdfSafe(`${block.program.name} · ${block.phase}`), M, top + 28);
  doc.text(weekLabel(block.startDate, week), W - M, top + 28, { align: "right" });

  doc.setDrawColor(...INK);
  doc.setLineWidth(1);
  doc.line(M, top + 36, W - M, top + 36);
  return top + 56;
}

function dayTitle(doc: jsPDF, text: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(text, M, y);
  return y + 8;
}

function tableHead(doc: jsPDF, cols: Col[], y: number): number {
  const h = 18;
  const width = cols.reduce((s, c) => s + c.width, 0);
  doc.setFillColor(...SHADE);
  doc.rect(M, y, width, h, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  let x = M;
  for (const col of cols) {
    doc.text(pdfSafe(t(col.title).toUpperCase()), x + PAD, y + 12);
    x += col.width;
  }
  return y + h;
}

function tableRow(
  doc: jsPDF,
  cols: Col[],
  cells: Record<ColKey, string>,
  sets: number,
  h: number,
  y: number,
) {
  let x = M;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);

  for (const col of cols) {
    doc.rect(x, y, col.width, h);
    if (col.key === "done") {
      drawBoxes(doc, x, y, col.width, sets);
    } else {
      const bold = col.key === "exercise" || col.key === "load";
      doc.setFont("helvetica", col.key === "notes" ? "italic" : bold ? "bold" : "normal");
      doc.setFontSize(9);
      doc.setTextColor(...(col.key === "notes" ? MUTED : INK));
      const lines = doc.splitTextToSize(cells[col.key], col.width - PAD * 2) as string[];
      lines.forEach((line, i) => doc.text(line, x + PAD, y + PAD + 8 + i * LINE_H));
    }
    x += col.width;
  }
  return y + h;
}

/** A group of empty boxes per set — weight, reps, RPE, as many as the coach asked for. */
function drawBoxes(doc: jsPDF, x: number, y: number, width: number, sets: number) {
  const per = activeSettings().logBoxes;
  if (per <= 0 || sets <= 0) return;
  const group = per * BOX + (per - 1) * BOX_GAP;
  const perLine = Math.max(1, Math.floor((width - PAD * 2 + SET_GAP) / (group + SET_GAP)));
  doc.setDrawColor(...MUTED);
  doc.setLineWidth(0.6);
  for (let s = 0; s < sets; s++) {
    const line = Math.floor(s / perLine);
    const col = s % perLine;
    const gx = x + PAD + col * (group + SET_GAP);
    const gy = y + PAD + line * (BOX + 4);
    for (let b = 0; b < per; b++) doc.rect(gx + b * (BOX + BOX_GAP), gy, BOX, BOX);
  }
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
}

function footers(doc: jsPDF, block: BlockWithDays, W: number, H: number) {
  const pages = doc.getNumberOfPages();
  const brand = activeSettings().branding.name.trim();
  const note = footerText();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const left = [brand, block.athlete.name, block.program.name].filter(Boolean).join(" · ");
    doc.text(pdfSafe(left), M, H - M + 8);
    if (note) doc.text(pdfSafe(note), W / 2, H - M + 8, { align: "center", maxWidth: W / 2 - M });
    doc.text(`${i} / ${pages}`, W - M, H - M + 8, { align: "right" });
  }
}
