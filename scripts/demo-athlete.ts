/**
 * Puts a demo athlete in the local database: a competitive 93 kg powerlifter with half a
 * year of training behind him, so Tracking's charts have something real to draw.
 *
 *   npx tsx scripts/demo-athlete.ts            add (or rebuild) the demo athlete
 *   npx tsx scripts/demo-athlete.ts --remove   take him out again
 *
 * Everything is dated from today, and a fixed seed keeps the numbers the same each run.
 * He is a plain athlete row of the first coach, so he syncs like any other if the desktop
 * app is signed in to a server.
 */
import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient, type IntensityType, type Tier } from "@prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! }) });

const NAME = "Demo · Jonas Weber";

// --- Dates and randomness ---------------------------------------------------------------

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
const now = new Date();
const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
const thisMonday = plus(today, -((today.getUTCDay() + 6) % 7));

/** Mulberry32: the same "random" numbers every run. */
let seed = 93;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
const noise = (sd: number) => (rand() + rand() + rand() - 1.5) * sd * 1.41;
const chance = (p: number) => rand() < p;
const r25 = (w: number) => Math.round(w / 2.5) * 2.5;
const half = (v: number) => Math.round(v * 2) / 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// --- The plan: two programs, phases back to back, the last one still to come -------------

type PhaseSpec = { phase: string; weeks: number; kind: "hyp" | "str" | "peak" | "vol" | "int"; kcal: number };
const PROGRAMS: { name: string; startWeek: number; phases: PhaseSpec[] }[] = [
  {
    name: "Nationals 2026",
    startWeek: -22,
    phases: [
      { phase: "Hypertrophy", weeks: 6, kind: "hyp", kcal: 3400 },
      { phase: "Strength", weeks: 5, kind: "str", kcal: 3200 },
      { phase: "Peak", weeks: 4, kind: "peak", kcal: 2750 },
    ],
  },
  {
    name: "Worlds 2026",
    startWeek: -6,
    phases: [
      { phase: "Volume", weeks: 5, kind: "vol", kcal: 3500 },
      { phase: "Intensification", weeks: 4, kind: "int", kcal: 3300 },
      { phase: "Peak", weeks: 4, kind: "peak", kcal: 2800 },
    ],
  },
];
// Nationals is on the Saturday of week -8; Worlds on the Saturday of the last planned week.
const NATIONALS = plus(thisMonday, -8 * 7 + 5);
const WORLDS = plus(thisMonday, (-6 + 5 + 4 + 4 - 1) * 7 + 5);

type Lift = "squat" | "bench" | "dead";
/** His real max on a week (0 = this week), which the logged sets are worked back from. */
function trueMax(lift: Lift, week: number): number {
  const at = (pts: [number, number][]) => {
    for (let i = 1; i < pts.length; i++) {
      const [w0, v0] = pts[i - 1];
      const [w1, v1] = pts[i];
      if (week <= w1) return v0 + ((v1 - v0) * (week - w0)) / (w1 - w0);
    }
    return pts[pts.length - 1][1];
  };
  const curves: Record<Lift, [number, number][]> = {
    squat: [[-22, 238], [-12, 247], [-8, 256], [-7, 250], [0, 262], [8, 268]],
    bench: [[-22, 158], [-12, 163], [-8, 168], [-7, 165], [0, 172], [8, 175]],
    dead: [[-22, 282], [-12, 292], [-8, 301], [-7, 294], [0, 309], [8, 316]],
  };
  return at(curves[lift]);
}

/** % of max and set × rep scheme for a main lift, by phase and week in it (1-based). */
function mainScheme(kind: PhaseSpec["kind"], week: number, weeks: number): { sets: number; reps: number; pct: number } {
  const last = week === weeks;
  switch (kind) {
    case "hyp":
      return last ? { sets: 3, reps: 6, pct: 65 } : { sets: 4, reps: 8, pct: 69 + week * 1.2 };
    case "str":
      return last ? { sets: 3, reps: 3, pct: 72 } : { sets: 4, reps: 5, pct: 78 + week * 1.5 };
    case "peak":
      return last ? { sets: 2, reps: 2, pct: 75 } : { sets: 3, reps: week === weeks - 1 ? 1 : 2, pct: 87 + week * 2 };
    case "vol":
      return last ? { sets: 3, reps: 5, pct: 68 } : { sets: 5, reps: 6, pct: 72 + week * 1.2 };
    case "int":
      return { sets: 4, reps: 4, pct: 81 + week * 1.5 };
  }
}

type RowSpec = { tier: Tier; target: string; exercise: string; lift?: Lift; main?: boolean; share?: number; sets?: number; reps?: number; rpe?: number; start?: number; gain?: number };
const DAYS: { index: number; label: string; rows: RowSpec[] }[] = [
  {
    index: 0,
    label: "Squat · Bench",
    rows: [
      { tier: "PRIMARY", target: "Squat", exercise: "Back Squat", lift: "squat", main: true },
      { tier: "PRIMARY", target: "Bench", exercise: "Bench Press", lift: "bench", main: true },
      { tier: "ACCESSORY", target: "Quadriceps", exercise: "Leg Press", sets: 3, reps: 10, rpe: 8, start: 200, gain: 1.5 },
      { tier: "ACCESSORY", target: "Back", exercise: "Lat Pulldown", sets: 3, reps: 12, rpe: 8, start: 70, gain: 0.5 },
    ],
  },
  {
    index: 2,
    label: "Deadlift",
    rows: [
      { tier: "PRIMARY", target: "Deadlift", exercise: "Deadlift", lift: "dead", main: true },
      { tier: "VARIATION", target: "Bench", exercise: "Spoto Press", lift: "bench", share: 0.84, sets: 3, reps: 5, rpe: 7.5 },
      { tier: "ACCESSORY", target: "Hamstrings", exercise: "Romanian Deadlift", sets: 3, reps: 8, rpe: 7.5, start: 160, gain: 1 },
      { tier: "ACCESSORY", target: "Core", exercise: "Ab Wheel", sets: 3, reps: 12, rpe: 8 },
    ],
  },
  {
    index: 4,
    label: "Squat volume · Bench",
    rows: [
      { tier: "VARIATION", target: "Squat", exercise: "Pause Squat", lift: "squat", share: 0.82, sets: 3, reps: 4, rpe: 7.5 },
      { tier: "SECONDARY", target: "Bench", exercise: "Bench Press", lift: "bench", share: 0.78, sets: 4, reps: 6, rpe: 7.5 },
      { tier: "ACCESSORY", target: "Back", exercise: "DB Row", sets: 3, reps: 10, rpe: 8, start: 42, gain: 0.25 },
      { tier: "ACCESSORY", target: "Arms", exercise: "Triceps Pushdown", sets: 3, reps: 15, rpe: 8.5, start: 35, gain: 0.25 },
    ],
  },
  {
    index: 5,
    label: "Pull · Press",
    rows: [
      { tier: "VARIATION", target: "Deadlift", exercise: "Deficit Deadlift", lift: "dead", share: 0.8, sets: 3, reps: 3, rpe: 7.5 },
      { tier: "VARIATION", target: "Bench", exercise: "Close-Grip Bench", lift: "bench", share: 0.86, sets: 3, reps: 6, rpe: 8 },
      { tier: "ACCESSORY", target: "Quadriceps", exercise: "Bulgarian Split Squat", sets: 3, reps: 8, rpe: 8, start: 24, gain: 0.25 },
      { tier: "ACCESSORY", target: "Shoulders", exercise: "Face Pull", sets: 3, reps: 15, rpe: 8, start: 25, gain: 0.15 },
    ],
  },
];

// --- Readiness: a slow wave with rough patches, which every logged RPE leans on ----------

const READINESS = new Map<string, number>();
{
  let r = 3.7;
  for (let d = plus(thisMonday, -22 * 7 - 3); d <= today; d = plus(d, 1)) {
    const week = Math.floor((d.getTime() - thisMonday.getTime()) / (7 * DAY));
    let pull = 3.7;
    if (week === -12 || week === -11) pull = 3.0; // work deadline at the end of Strength
    if (week === -10 || week === -9) pull = 3.2; // peaking fatigue
    if (week === -8) pull = 4.1; // taper, meet week
    if (week === -2) pull = 2.9; // a cold
    r = clamp(r + (pull - r) * 0.35 + noise(0.45), 1.3, 5);
    READINESS.set(ymd(d), r);
  }
}
const readinessOn = (d: Date) => READINESS.get(ymd(d)) ?? 3.6;

/** Reps he could do at a share of his max — Brzycki, close to an RPE chart. */
const repsAt = (share: number) => (1.0278 - share) / 0.0278;
/** The share of his max he can do this many reps at, this many short of failure. */
const shareFor = (reps: number, rpe: number) => 1.0278 - 0.0278 * (reps + 10 - rpe);

/** The RPE a set feels like: reps left in reserve at that share of his real max, nudged by the day. */
function feltRpe(weight: number, reps: number, max: number, day: Date) {
  const toFailure = repsAt(weight / max);
  // Logged a touch high, as lifters do: the last rep always looks slower from inside it.
  const rpe = 10.5 - (toFailure - reps) - 0.45 * (readinessOn(day) - 3.6) + noise(0.25);
  return clamp(half(rpe), 5.5, 10);
}

// --- Build ------------------------------------------------------------------------------

async function remove() {
  const gone = await prisma.athlete.deleteMany({ where: { name: NAME } });
  console.log(gone.count ? `Removed ${NAME}.` : `No ${NAME} to remove.`);
}

async function main() {
  if (process.argv.includes("--remove")) return remove();
  await remove();
  const coach = await prisma.coach.findFirstOrThrow({ orderBy: { username: "asc" } });

  const athlete = await prisma.athlete.create({
    data: {
      coachId: coach.id,
      name: NAME,
      unit: "KG",
      sex: "M",
      squat1RM: 262.5,
      bench1RM: 172.5,
      dead1RM: 310,
      notes: "93 kg, IPF. Nationals silver this summer; Worlds selection is the goal. Squat is the lift to chase.",
    },
  });

  const best: Record<Lift, number> = { squat: 0, bench: 0, dead: 0 };
  let activeProgramId: string | null = null;
  let rows = 0;
  let sets = 0;

  for (const program of PROGRAMS) {
    const p = await prisma.program.create({ data: { athleteId: athlete.id, name: program.name } });
    activeProgramId = p.id;
    let week0 = program.startWeek;
    for (const [order, ph] of program.phases.entries()) {
      const start = plus(thisMonday, week0 * 7);
      const onFile = (lift: Lift) => r25(trueMax(lift, week0) - 2.5);
      const weeks = [];
      for (let w = 1; w <= ph.weeks; w++) {
        const weekAt = week0 + w - 1;
        const days = [];
        for (let index = 0; index < 7; index++) {
          const spec = DAYS.find((d) => d.index === index);
          if (!spec) {
            days.push({ index, label: "Rest", rest: true });
            continue;
          }
          const date = plus(start, (w - 1) * 7 + index);
          const meetWeek = ph.kind === "peak" && w === ph.weeks;
          // Meet week: only Monday's openers.
          if (meetWeek && index > 0) {
            days.push({ index, label: index === 5 && date.getTime() === NATIONALS.getTime() ? "Meet day" : "Rest", rest: true });
            continue;
          }
          const logged = date < today || (date.getTime() === today.getTime() && now.getHours() > 18);
          const skipped = logged && chance(0.05);
          const rowsOut = [];
          for (const [ri, row] of spec.rows.entries()) {
            const main = row.main ? mainScheme(ph.kind, w, ph.weeks) : null;
            const sets_ = main?.sets ?? (ph.kind === "peak" ? Math.max(2, (row.sets ?? 3) - 1) : row.sets ?? 3);
            const reps = main?.reps ?? row.reps ?? 8;
            let intensityType: IntensityType = "RPE";
            let intensity: number = row.rpe ?? 8;
            let weight: number | null = null;
            let max = 0;
            if (row.lift) {
              max = trueMax(row.lift, weekAt) * (row.share ?? 1);
              if (main) {
                intensityType = "PERCENT";
                intensity = Math.round(main.pct * 2) / 2;
                weight = r25((onFile(row.lift) * main.pct) / 100);
              } else {
                // Worked up to the RPE asked for, off his real max.
                weight = r25(max * shareFor(reps, intensity) * (1 + noise(0.015)));
              }
            } else if (row.start) {
              weight = r25(row.start + (row.gain ?? 0) * (weekAt + 22));
            }
            // A sore back keeps him off deficits for a couple of weeks.
            const backOff = row.exercise === "Deficit Deadlift" && weekAt >= -15 && weekAt <= -14;
            const doneSets = !logged || skipped || backOff ? 0 : chance(0.05) ? sets_ - 1 : sets_;
            const logs = [];
            let top: { weight: number; rpe: number } | null = null;
            for (let s = 0; s < doneSets; s++) {
              const w_ = weight;
              const rpe = w_ !== null && max > 0 ? clamp(feltRpe(w_, reps, max, date) + (s === sets_ - 1 ? 0.5 : 0), 5.5, 10) : half(intensity + noise(0.4) - 0.3 * (readinessOn(date) - 3.6));
              let pr = false;
              if (row.main && row.lift && w_ !== null && s === 0) {
                const e1rm = w_ / shareFor(reps, rpe);
                if (best[row.lift] > 0 && e1rm > best[row.lift] + 1) pr = true;
                best[row.lift] = Math.max(best[row.lift], e1rm);
              }
              logs.push({ setIndex: s, weight: w_, reps, rpe: clamp(rpe, 5.5, 10), done: true, pr, loggedAt: plus(date, 0.75) });
              if (w_ !== null && (!top || w_ >= top.weight)) top = { weight: w_, rpe: clamp(rpe, 5.5, 10) };
              sets++;
            }
            rows++;
            rowsOut.push({
              order: ri,
              tier: row.tier,
              target: row.target,
              exercise: row.exercise,
              sets: sets_,
              reps,
              intensityType,
              intensity,
              restTime: row.main ? "3-5 min" : "2 min",
              actualWeight: top?.weight ?? null,
              performedRpe: top?.rpe ?? null,
              logs: { create: logs },
            });
          }
          days.push({ index, label: meetWeek ? "Openers" : spec.label, rest: false, reviewedAt: date < plus(today, -2) && chance(0.9) ? plus(date, 1) : null, rows: { create: rowsOut } });
        }
        weeks.push({ order: w, days: { create: days } });
      }
      await prisma.block.create({
        data: {
          athleteId: athlete.id,
          programId: p.id,
          order,
          phase: ph.phase,
          startDate: start,
          squat1RM: onFile("squat"),
          bench1RM: onFile("bench"),
          dead1RM: onFile("dead"),
          kcalTarget: ph.kcal,
          proteinTarget: 200,
          carbsTarget: Math.round((ph.kcal - 200 * 4 - 85 * 9) / 4),
          fatTarget: 85,
          weeks: { create: weeks },
        },
      });
      week0 += ph.weeks;
    }
    week0 += 1; // a week off between programs
  }
  await prisma.athlete.update({ where: { id: athlete.id }, data: { activeProgramId } });

  // Bodyweight: ~95 kg, cut into the 93s for Nationals, back up after.
  const weighIns = [];
  const nutrition = [];
  const kcalOn = (d: Date) => {
    const w = (d.getTime() - thisMonday.getTime()) / (7 * DAY);
    if (w < -16) return 3400;
    if (w < -11) return 3200;
    if (w < -7) return 2750;
    if (w < -6) return 3600;
    if (w < -1) return 3500;
    return 3300;
  };
  for (let d = plus(thisMonday, -22 * 7); d <= today; d = plus(d, 1)) {
    const days = (d.getTime() - NATIONALS.getTime()) / DAY;
    let bw: number;
    if (days < -35) bw = 95.3 + 0.004 * (days + 154);
    else if (days < -2) bw = 95.7 - (2.9 * (days + 35)) / 33;
    else if (days <= 0) bw = 92.6 - 0.15 * (days + 2);
    else bw = Math.min(95.6, 92.3 + 2.4 * (1 - Math.exp(-days / 5)) + 0.012 * days);
    if (chance(0.9)) weighIns.push({ athleteId: athlete.id, day: ymd(d), weight: Math.round((bw + noise(0.35)) * 10) / 10, source: "athlete" });

    if (chance(0.85)) {
      const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      const kcal = Math.round(kcalOn(d) + noise(170) + (weekend ? 220 : 0));
      const protein = Math.round(200 + noise(14));
      const fat = Math.round(85 + noise(12) + (weekend ? 10 : 0));
      const carbs = Math.max(120, Math.round((kcal - protein * 4 - fat * 9) / 4));
      nutrition.push({ id: `n-${athlete.id}-${ymd(d)}`, athleteId: athlete.id, day: ymd(d), kcal, protein, carbs, fat, source: "athlete" });
    }
  }
  await prisma.bodyweightLog.createMany({ data: weighIns });
  await prisma.nutritionLog.createMany({ data: nutrition });

  // Daily check-in, answered most days, every answer leaning on that day's readiness.
  const q = async (order: number, label: string, kind: "SCALE" | "NUMBER" | "YESNO" | "TEXT", config: object, icon: string, color: string) =>
    prisma.checkinQuestion.create({ data: { athleteId: athlete.id, order, label, kind, config: JSON.stringify(config), icon, color } });
  const sleep = await q(0, "Sleep quality", "SCALE", { min: 1, max: 5, low: "Poor", high: "Great" }, "bed", "blue");
  const hours = await q(1, "Sleep", "NUMBER", { unit: "h" }, "moon", "blue");
  const energy = await q(2, "Energy", "SCALE", { min: 1, max: 5, low: "Flat", high: "Ready to go" }, "zap", "amber");
  const soreness = await q(3, "Soreness", "SCALE", { min: 1, max: 5, low: "Very sore", high: "Fresh" }, "bandage", "red");
  const stress = await q(4, "Stress", "SCALE", { min: 1, max: 5, low: "Very stressed", high: "Relaxed" }, "gauge", "orange");
  const creatine = await q(5, "Took creatine", "YESNO", {}, "pill", "purple");
  const notes = await q(6, "Notes", "TEXT", {}, "note", "purple");
  const NOTES = ["Hips tight on the walkout", "Bar speed felt great", "Slept badly, neighbours", "Long day at work", "Felt strong today", "Elbow a bit cranky on close grip"];
  const answers = [];
  for (let d = plus(thisMonday, -22 * 7); d <= today; d = plus(d, 1)) {
    if (!chance(0.88)) continue;
    const r = readinessOn(d);
    const scale = (bias = 0, sd = 0.55) => String(clamp(Math.round(r + bias + noise(sd)), 1, 5));
    const day = ymd(d);
    const week = Math.floor((d.getTime() - thisMonday.getTime()) / (7 * DAY));
    const sleepScore = scale(0.1);
    answers.push(
      { athleteId: athlete.id, questionId: sleep.id, day, value: sleepScore },
      { athleteId: athlete.id, questionId: hours.id, day, value: String(Math.round((7.1 + 0.45 * (Number(sleepScore) - 3) + noise(0.35)) * 4) / 4) },
      { athleteId: athlete.id, questionId: energy.id, day, value: scale(0) },
      { athleteId: athlete.id, questionId: soreness.id, day, value: scale(d.getUTCDay() === 2 || d.getUTCDay() === 6 ? -0.6 : 0.1) },
      { athleteId: athlete.id, questionId: stress.id, day, value: scale(week === -12 || week === -11 ? -0.8 : 0.2) },
      { athleteId: athlete.id, questionId: creatine.id, day, value: chance(0.9) ? "yes" : "no" },
    );
    if (chance(0.12)) answers.push({ athleteId: athlete.id, questionId: notes.id, day, value: NOTES[Math.floor(rand() * NOTES.length)] });
  }
  await prisma.checkinAnswer.createMany({ data: answers });

  const at = (week: number, day: number) => ymd(plus(thisMonday, week * 7 + day));
  await prisma.injury.createMany({
    data: [
      { athleteId: athlete.id, area: "low-back", side: null, day: at(-15, 5), endDay: at(-13, 2), severity: 2, note: "Tweaked on deficits, eased off them", source: "athlete" },
      { athleteId: athlete.id, area: "knee", side: "R", day: at(-10, 0), endDay: at(-7, 3), severity: 3, note: "Patellar tendon, sore out of the hole", source: "athlete" },
      { athleteId: athlete.id, area: "elbow", side: "L", day: at(-1, 4), endDay: null, severity: 1, note: "Close grip aggravates it", source: "coach" },
    ],
  });

  const nationals = await prisma.meet.create({
    data: { athleteId: athlete.id, name: "Nationals 2026", federation: "IPF", weightClass: "93", bodyweight: 92.4, date: NATIONALS },
  });
  const ATTEMPTS: [("SQUAT" | "BENCH" | "DEADLIFT"), number, number, "GOOD" | "MISS"][] = [
    ["SQUAT", 1, 235, "GOOD"], ["SQUAT", 2, 247.5, "GOOD"], ["SQUAT", 3, 255, "MISS"],
    ["BENCH", 1, 155, "GOOD"], ["BENCH", 2, 162.5, "GOOD"], ["BENCH", 3, 167.5, "GOOD"],
    ["DEADLIFT", 1, 280, "GOOD"], ["DEADLIFT", 2, 292.5, "GOOD"], ["DEADLIFT", 3, 302.5, "GOOD"],
  ];
  await prisma.attempt.createMany({ data: ATTEMPTS.map(([lift, number, weight, result]) => ({ meetId: nationals.id, lift, number, weight, result })) });
  await prisma.meet.create({ data: { athleteId: athlete.id, name: "Worlds 2026", federation: "IPF", weightClass: "93", date: WORLDS } });

  console.log(
    `Added ${NAME}: ${rows} rows, ${sets} sets, ${weighIns.length} weigh-ins, ${nutrition.length} nutrition days, ${answers.length} check-in answers. Nationals ${ymd(NATIONALS)}, Worlds ${ymd(WORLDS)}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
