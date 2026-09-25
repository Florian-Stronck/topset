import ExcelJS from "exceljs";
import { formatPrescription, formatRamp, maxesOf, resolveDay } from "@/lib/intensity";
import type { BlockWithDays } from "@/lib/queries";
import { WEEKDAYS } from "@/lib/types";
import { dayName } from "@/lib/days";
import { activeSettings, tierLabel } from "@/lib/settings";
import { formatDate, today, weekdayOfDay, ymdOf } from "@/lib/dates";
import { imageSize } from "@/lib/branding";
import { t } from "@/lib/i18n";

type RowOut = BlockWithDays["weeks"][number]["days"][number]["rows"][number];
type WeekColumn = {
  title: string;
  width: number;
  value: (row: RowOut, extra: { prescription: string | null; weight: number | null }) => string | number | null;
};

/** The per-row columns, minus the ones the coach switched off for exports. */
function weekColumns(): WeekColumn[] {
  const show = activeSettings().exportColumns;
  const cols: (WeekColumn | false)[] = [
    { title: "Sets", width: 10, value: (r) => r.sets },
    { title: "Reps", width: 10, value: (r) => r.reps },
    { title: "Intensity", width: 12, value: (_, e) => e.prescription },
    { title: "Target weight", width: 13, value: (_, e) => e.weight },
    show.tempo && { title: "Tempo", width: 10, value: (r) => r.tempo },
    show.rest && { title: "Rest", width: 10, value: (r) => r.restTime },
    show.notes && { title: "Coach notes", width: 26, value: (r) => r.coachNotes },
    show.video && { title: "Video", width: 26, value: (r) => r.videoUrl },
    { title: "Actual weight", width: 13, value: (r) => r.actualWeight },
    { title: "Performed RPE", width: 10, value: (r) => r.performedRpe },
    { title: "Athlete notes", width: 26, value: (r) => r.athleteNotes },
  ];
  return cols.filter((c): c is WeekColumn => Boolean(c));
}

const LEFT_HEADERS = ["#", "Tier", "Target", "Exercise"];

/** "Week 3" in the coach's language, matched back when the sheet is styled. */
function weekBanner(n: number | string, locked = false) {
  const week = t("Week {n}", { n });
  return locked ? `${week} · ${t("Locked")}` : week;
}

function isWeekBanner(text: string) {
  const pattern = weekBanner("__N__")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace("__N__", "\\d+");
  return new RegExp(`^${pattern}( · .+)?$`).test(text);
}


type Matrix = (string | number | null)[][];

function buildMatrix(block: BlockWithDays): Matrix {
  const athlete = block.athlete;
  // The header and every target weight come off the block's own maxes.
  const maxes = maxesOf(block, athlete);
  const rows: Matrix = [];
  const columns = weekColumns();

  rows.push([`${block.program.name} — ${block.phase}`, athlete.name]);
  rows.push([
    t("Start"),
    ymdOf(block.startDate),
    "1RM",
    `SQ ${maxes.squat1RM ?? "—"}`,
    `BP ${maxes.bench1RM ?? "—"}`,
    `DL ${maxes.dead1RM ?? "—"}`,
  ]);
  rows.push([]);

  // Weeks own their days now, so each one is written out in full rather than as another
  // set of columns beside a skeleton they would all have to share.
  for (const week of block.weeks) {
    rows.push([weekBanner(week.order, week.locked)]);
    rows.push([...LEFT_HEADERS.map((h) => t(h)), ...columns.map((c) => t(c.title))]);

    for (const day of week.days) {
      rows.push([`${t(WEEKDAYS[weekdayOfDay(block.startDate, day.index)])} — ${dayName(day)}`]);
      if (day.rest && day.rows.length === 0) continue;

      const resolved = resolveDay(day.rows, maxes);

      // Unnamed rows are the grid's ghost slots, not prescriptions.
      for (const [i, row] of day.rows.filter((r) => r.exercise.trim() !== "").entries()) {
        const target = resolved.get(row.id) ?? { label: "—", weight: null };
        const ramp = formatRamp(row, athlete.unit);
        const prescription =
          row.intensity === null
            ? null
            : [formatPrescription(row, athlete.unit), ramp].filter(Boolean).join(" · ");

        rows.push([
          i + 1,
          tierLabel(row.tier),
          row.target,
          row.exercise,
          ...columns.map((c) => c.value(row, { prescription, weight: target.weight })),
        ]);
      }
      rows.push([]);
    }
  }

  return rows;
}

export function toCsv(block: BlockWithDays): string {
  const escape = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return buildMatrix(block)
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
}

/** Excel sheet names: at most 31 characters, none of []:*?/\, unique in the workbook. */
function sheetName(phase: string, index: number, taken: Set<string>): string {
  const clean = phase.replace(/[[\]:*?/\\]/g, " ").trim();
  const base = `${index + 1}. ${clean || "Phase"}`.slice(0, 31);
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

/** The whole program as one workbook, a sheet per phase in order. */
export async function toXlsx(phases: BlockWithDays[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Topset";
  wb.created = new Date();

  const taken = new Set<string>();
  addCoverSheet(wb, phases, taken);
  phases.forEach((phase, i) => addPhaseSheet(wb, phase, sheetName(phase.phase, i, taken)));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}


const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The first sheet: the coach's logo and name, then what the program is — who it is for,
 * when it runs, and its phases with their dates and maxes. The phase sheets follow.
 */
function addCoverSheet(wb: ExcelJS.Workbook, phases: BlockWithDays[], taken: Set<string>) {
  const first = phases[0];
  if (!first) return;
  const title = t("Start").slice(0, 31);
  taken.add(title.toLowerCase());
  const ws = wb.addWorksheet(title, { views: [{ showGridLines: false }] });
  ws.columns = [
    { width: 5 },
    { width: 24 },
    { width: 13 },
    { width: 13 },
    { width: 9 },
    { width: 14 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
  ];

  let row = 1;

  // The logo keeps its proportions, up to 360 × 140 px, and the text starts below it.
  const logo = activeSettings().branding.logo;
  const m = logo ? /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(logo) : null;
  if (m) {
    const size = imageSize(Buffer.from(m[2], "base64"));
    if (size) {
      const scale = Math.min(360 / size.width, 140 / size.height, 1);
      const width = Math.round(size.width * scale);
      const height = Math.round(size.height * scale);
      try {
        const id = wb.addImage({ base64: m[2], extension: m[1].toLowerCase() === "png" ? "png" : "jpeg" });
        ws.addImage(id, { tl: { col: 1, row: 1 }, ext: { width, height } });
        row = 2 + Math.ceil(height / 20) + 1;
      } catch {
        // A broken logo shouldn't cost the export.
      }
    }
  }

  const put = (values: (string | number | null)[], font: Partial<ExcelJS.Font> = {}) => {
    const r = ws.getRow(row++);
    values.forEach((v, i) => (r.getCell(i + 2).value = v));
    r.font = font;
    return r;
  };

  const coach = activeSettings().branding.name.trim();
  if (coach) put([coach], { bold: true, size: 12, color: { argb: "FF555560" } });
  put([first.program.name], { bold: true, size: 22 });
  put([first.athlete.name], { size: 14 });

  const last = phases[phases.length - 1];
  const end = new Date(last.startDate.getTime() + last.weeks.length * 7 * DAY_MS - DAY_MS);
  const weeks = phases.reduce((n, p) => n + p.weeks.length, 0);
  put(
    [`${formatDate(first.startDate, true)} – ${formatDate(end, true)} · ${t(weeks === 1 ? "{n} week" : "{n} weeks", { n: weeks })}`],
    { size: 11, color: { argb: "FF555560" } },
  );
  row++;

  const head = ws.getRow(row++);
  ["#", t("Phase"), t("Start"), t("End"), t("Weeks"), t("Training days"), "SQ", "BP", "DL"].forEach((v, c) => {
    const cell = head.getCell(c + 1);
    cell.value = v;
    cell.font = { bold: true, size: 10, color: { argb: "FFEAEAEE" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF23232B" } };
  });

  phases.forEach((phase, i) => {
    const maxes = maxesOf(phase, phase.athlete);
    const phaseEnd = new Date(phase.startDate.getTime() + phase.weeks.length * 7 * DAY_MS - DAY_MS);
    const training = phase.weeks[0]?.days.filter((d) => !d.rest).length ?? 0;
    const r = ws.getRow(row++);
    [
      i + 1,
      phase.phase,
      formatDate(phase.startDate, true),
      formatDate(phaseEnd, true),
      phase.weeks.length,
      training,
      maxes.squat1RM,
      maxes.bench1RM,
      maxes.dead1RM,
    ].forEach((v, c) => (r.getCell(c + 1).value = v));
  });

  row++;
  put([`${t("Unit")}: ${first.athlete.unit === "LB" ? "lb" : "kg"} · ${t("Created {date}", { date: formatDate(today(), true) })}`], {
    size: 9,
    color: { argb: "FF8B8B98" },
  });
}

function addPhaseSheet(wb: ExcelJS.Workbook, block: BlockWithDays, name: string) {
  const ws = wb.addWorksheet(name, {
    views: [{ state: "frozen", xSplit: 4, ySplit: 5 }],
  });

  const matrix = buildMatrix(block);
  matrix.forEach((row) => ws.addRow(row));

  ws.getRow(1).font = { bold: true, size: 14 };

  const columns = weekColumns();
  ws.columns.forEach((col, i) => {
    col.width = i < LEFT_HEADERS.length ? [5, 12, 14, 24][i] : (columns[i - LEFT_HEADERS.length]?.width ?? 10);
  });

  matrix.forEach((row, i) => {
    const r = ws.getRow(i + 1);

    // A week banner and a day label are both a single populated cell; the week's is the
    // one that reads "Week N".
    if (row.length === 1 && typeof row[0] === "string") {
      const isWeek = isWeekBanner(row[0]);
      r.font = isWeek
        ? { bold: true, size: 12, color: { argb: "FFFFFFFF" } }
        : { bold: true, color: { argb: "FFE5365A" } };
      if (isWeek) {
        r.getCell(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE5365A" },
        };
      }
      return;
    }

    if (row[0] === LEFT_HEADERS[0]) {
      r.alignment = { horizontal: "center", wrapText: true };
      r.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF23232B" } };
        cell.font = { bold: true, size: 10, color: { argb: "FFEAEAEE" } };
      });
    }
  });
}
