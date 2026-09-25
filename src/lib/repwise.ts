import ExcelJS from "exceljs";
import { maxesOf, percentOf1RM, resolveDay } from "@/lib/intensity";
import type { BlockWithDays, RowWithRules } from "@/lib/queries";

/**
 * Export in the layout Repwise (RPECALC) reads: one tab per week, eight columns.
 *
 *   A exercise (or a day name when B is empty)   E keywords — Ramp, Pause, Tempo
 *   B sets, integer; blank marks a day header    F unit override
 *   C reps                                       G interval / distance helper
 *   D RPE, or a backoff drop like -10%           H annotation, ignored by Repwise
 *
 * The blank-B rule is what makes a day header, so an exercise whose sets are missing is
 * written as 1 rather than left empty — otherwise Repwise would read it as a new day.
 */
export const REPWISE_COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

type Cell = string | number | null;
export type RepwiseSheet = { name: string; rows: Cell[][] };

/** Repwise speaks RPE. This finds the RPE our own table would price at that percentage. */
function rpeForPercent(reps: number | null, percent: number): number | null {
  if (reps === null) return null;
  let best: { rpe: number; gap: number } | null = null;

  for (let rpe = 10; rpe >= 5; rpe -= 0.5) {
    const pct = percentOf1RM(reps, rpe);
    if (pct === null) continue;
    const gap = Math.abs(pct - percent);
    if (best === null || gap < best.gap) best = { rpe, gap };
  }

  // More than a couple of percent out means the table has nothing sensible to say.
  return best && best.gap <= 2.5 ? best.rpe : null;
}

type Converted = { rpe: Cell; keywords: string; note: string };

function convertIntensity(
  cell: RowWithRules,
  reps: number | null,
  unit: string,
): Converted {
  const keywords = cell.rampStep ? "Ramp" : "";
  const blank = { rpe: null as Cell, keywords, note: "" };
  if (cell.intensity === null) return blank;

  switch (cell.intensityType) {
    case "RPE":
      return { rpe: cell.intensity, keywords, note: "" };

    case "RIR":
      // Repwise has no RIR column; the two scales are the same line read from each end.
      return {
        rpe: Math.min(10, Math.max(1, 10 - cell.intensity)),
        keywords,
        note: `RIR ${cell.intensity} written as RPE`,
      };

    case "BACKOFF":
      return { rpe: `-${cell.intensity}%`, keywords, note: "" };

    case "PERCENT": {
      const rpe = rpeForPercent(reps, cell.intensity);
      return rpe === null
        ? { rpe: null, keywords, note: `${cell.intensity}% of 1RM — no RPE equivalent` }
        : { rpe, keywords, note: `RPE inferred from ${cell.intensity}%` };
    }

    case "RANGE":
      return {
        rpe: null,
        keywords,
        note: `Prescribed ${cell.intensity}–${cell.intensityMax ?? cell.intensity} ${unit}`,
      };

    default:
      return { rpe: null, keywords, note: `Prescribed ${cell.intensity} ${unit}` };
  }
}

export function toRepwiseSheets(block: BlockWithDays): RepwiseSheet[] {
  const athlete = block.athlete;
  const maxes = maxesOf(block, athlete);
  const unit = athlete.unit === "LB" ? "lb" : "kg";

  return block.weeks.map(({ order: week, days }) => {
    const rows: Cell[][] = [];

    for (const day of days) {
      const programmed = day.rows.filter((row) => row.exercise.trim() !== "");
      if (day.rest || programmed.length === 0) continue;

      const resolved = resolveDay(day.rows, maxes);

      // A day header: the name in A, every other column empty.
      rows.push([day.label, null, null, null, null, null, null, null]);

      for (const row of programmed) {
        const cell = row;

        const { rpe, keywords, note } = convertIntensity(cell, cell.reps, unit);
        const target = resolved.get(row.id)?.weight ?? null;

        const annotation = [
          note,
          target === null ? "" : `target ${target} ${unit}`,
          row.tier === "VARIATION" ? "variation — trained off 90% of the comp max" : "",
          cell.coachNotes ?? "",
        ]
          .filter(Boolean)
          .join(" · ");

        rows.push([
          row.exercise,
          cell.sets ?? 1,
          cell.reps ?? 1,
          rpe,
          keywords || null,
          null,
          null,
          annotation || null,
        ]);
      }

      rows.push([null, null, null, null, null, null, null, null]);
    }

    return { name: `Week ${week}`, rows };
  });
}

/** What a coach pastes straight into a Google Sheet tab. */
export function toRepwiseTsv(block: BlockWithDays): string {
  return toRepwiseSheets(block)
    .map((sheet) => {
      const body = sheet.rows
        .map((row) => row.map((cell) => (cell === null ? "" : String(cell))).join("\t"))
        .join("\r\n");
      return `=== ${sheet.name.toUpperCase()} ===\r\n${body}`;
    })
    .join("\r\n\r\n");
}

export async function toRepwiseXlsx(block: BlockWithDays): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Topset";
  wb.created = new Date();

  for (const sheet of toRepwiseSheets(block)) {
    const ws = wb.addWorksheet(sheet.name);
    sheet.rows.forEach((row) => ws.addRow(row));

    ws.columns = [
      { width: 26 },
      { width: 7 },
      { width: 7 },
      { width: 9 },
      { width: 14 },
      { width: 7 },
      { width: 10 },
      { width: 40 },
    ];

    // Day headers are the rows with a name and nothing else — bold, as they read on screen.
    sheet.rows.forEach((row, i) => {
      if (row[0] !== null && row[1] === null) ws.getRow(i + 1).font = { bold: true };
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
