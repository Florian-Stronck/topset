import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient, Tier, IntensityType } from "@prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! }),
});

type SeedRow = {
  tier: Tier;
  target: string;
  exercise: string;
  sets: number;
  reps: number;
  intensityType: IntensityType;
  intensity: number;
  coachNotes?: string;
};

type SeedDay = { index: number; label: string; rest?: boolean; rows?: SeedRow[] };

/** A phase whose weeks are laid out but not yet written: every other day a session. */
function emptyWeeks(count: number, label: string) {
  return {
    create: Array.from({ length: count }, (_, w) => ({
      order: w + 1,
      days: {
        create: Array.from({ length: 7 }, (_, i) => ({
          index: i,
          label: i % 2 === 0 ? label : "Rest",
          rest: i % 2 !== 0,
        })),
      },
    })),
  };
}

const days: SeedDay[] = [
  {
    index: 0,
    label: "Squat focus",
    rows: [
      { tier: "PRIMARY", target: "Squat", exercise: "Back Squat", sets: 4, reps: 5, intensityType: "RPE", intensity: 7, coachNotes: "Full depth, controlled eccentric." },
      { tier: "SECONDARY", target: "Squat", exercise: "Pause Squat", sets: 3, reps: 6, intensityType: "RPE", intensity: 7 },
      { tier: "ACCESSORY", target: "Quadriceps", exercise: "Leg Press", sets: 3, reps: 10, intensityType: "RPE", intensity: 7, coachNotes: "Full ROM, control the negative." },
    ],
  },
  { index: 1, label: "Rest", rest: true },
  {
    index: 2,
    label: "Bench focus",
    rows: [
      { tier: "PRIMARY", target: "Bench", exercise: "Bench Press", sets: 4, reps: 5, intensityType: "RPE", intensity: 7, coachNotes: "Pause every rep, keep the upper back tight." },
      { tier: "SECONDARY", target: "Bench", exercise: "Close-Grip Bench", sets: 3, reps: 6, intensityType: "RPE", intensity: 7 },
      { tier: "ACCESSORY", target: "Back", exercise: "Barbell Row", sets: 3, reps: 10, intensityType: "RPE", intensity: 7 },
    ],
  },
  { index: 3, label: "Rest", rest: true },
  {
    index: 4,
    label: "Deadlift focus",
    rows: [
      { tier: "PRIMARY", target: "Deadlift", exercise: "Deadlift", sets: 4, reps: 5, intensityType: "RPE", intensity: 7, coachNotes: "Reset every rep, brace hard off the floor." },
      { tier: "SECONDARY", target: "Deadlift", exercise: "Deficit Deadlift", sets: 3, reps: 6, intensityType: "RPE", intensity: 7, coachNotes: "1-inch deficit, hips down." },
      { tier: "ACCESSORY", target: "Hamstrings", exercise: "Romanian Deadlift", sets: 3, reps: 10, intensityType: "RPE", intensity: 7, coachNotes: "Soft knees, feel the hamstring stretch." },
    ],
  },
  { index: 5, label: "Rest", rest: true },
  { index: 6, label: "Rest", rest: true },
];

const WEEKS = 4;

async function main() {
  await prisma.coach.deleteMany();

  const coach = await prisma.coach.create({
    data: { username: "coach", name: "Topset Coach" },
  });

  const athlete = await prisma.athlete.create({
    data: {
      coachId: coach.id,
      name: "John Smith",
      unit: "KG",
      squat1RM: 220,
      bench1RM: 140,
      dead1RM: 255,
    },
  });

  // A program is a name; its phases hold the dates, the weeks and their own maxes.
  const program = await prisma.program.create({
    data: { athleteId: athlete.id, name: "IPF Worlds Prep 2026" },
  });

  const block = await prisma.block.create({
    data: {
      athleteId: athlete.id,
      programId: program.id,
      order: 0,
      phase: "Base Accumulation",
      startDate: new Date("2026-05-11"),
      squat1RM: athlete.squat1RM,
      bench1RM: athlete.bench1RM,
      dead1RM: athlete.dead1RM,
    },
  });

  // Each week owns its days. The same exercise in consecutive weeks is chained through
  // `fromId`, which is what lets a progression rule drive the weeks after it.
  let previous = new Map<string, string>();

  for (let w = 0; w < WEEKS; w++) {
    const week = await prisma.week.create({ data: { blockId: block.id, order: w + 1 } });
    const next = new Map<string, string>();

    for (const day of days) {
      const created = await prisma.day.create({
        data: { weekId: week.id, index: day.index, label: day.label, rest: day.rest ?? false },
      });

      for (const [order, row] of (day.rows ?? []).entries()) {
        const key = `${day.index}:${order}`;
        const made = await prisma.exerciseRow.create({
          data: {
            dayId: created.id,
            order,
            tier: row.tier,
            target: row.target,
            exercise: row.exercise,
            sets: row.sets,
            reps: row.reps,
            intensityType: row.intensityType,
            // Intensity climbs across the block: RPE 7 → 8.5.
            intensity: row.intensity + w * 0.5,
            coachNotes: w === 0 ? (row.coachNotes ?? null) : null,
            fromId: previous.get(key) ?? null,
          },
        });
        next.set(key, made.id);
      }
    }

    previous = next;
  }

  // The phase after it, in the same program: later dates, same plan.
  await prisma.block.create({
    data: {
      athleteId: athlete.id,
      programId: program.id,
      order: 1,
      phase: "Intensification",
      startDate: new Date("2026-06-08"),
      squat1RM: athlete.squat1RM,
      bench1RM: athlete.bench1RM,
      dead1RM: athlete.dead1RM,
      weeks: emptyWeeks(4, "Session"),
    },
  });

  await prisma.program.create({
    data: {
      athleteId: athlete.id,
      name: "Off-season 2026",
      phases: {
        create: {
          athleteId: athlete.id,
          order: 0,
          phase: "Hypertrophy",
          startDate: new Date("2026-02-02"),
          squat1RM: athlete.squat1RM,
          bench1RM: athlete.bench1RM,
          dead1RM: athlete.dead1RM,
          weeks: emptyWeeks(4, "Full body"),
        },
      },
    },
  });

  // A second athlete on the roster, in pounds, so multi-athlete views have
  // something to switch between out of the box.
  const second = await prisma.athlete.create({
    data: {
      coachId: coach.id,
      name: "Maria Lopez",
      unit: "LB",
      squat1RM: 345,
      bench1RM: 190,
      dead1RM: 405,
    },
  });

  await prisma.program.create({
    data: {
      athleteId: second.id,
      name: "Nationals Prep 2026",
      phases: {
        create: {
          athleteId: second.id,
          order: 0,
          phase: "Intensification",
          startDate: new Date("2026-04-06"),
          squat1RM: second.squat1RM,
          bench1RM: second.bench1RM,
          dead1RM: second.dead1RM,
          weeks: emptyWeeks(4, "Session"),
        },
      },
    },
  });

  console.log(
    "Seeded coach %s with athletes %s, %s and program %s",
    coach.username,
    athlete.name,
    second.name,
    program.name,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
