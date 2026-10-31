import Link from "next/link";
import { Heading } from "@/app/a/coach/parts";
import { formatDate, today as calendarToday, ymdOf } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { phoneAthletes, phoneCoach } from "@/lib/phone-coach";
import { prisma } from "@/lib/prisma";
import { daysBetween } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/** Every athlete's meets: the ones coming, soonest first, then the last few. */
export default async function PhoneMeets() {
  const coach = await phoneCoach();
  if (!coach) return null;
  const today = ymdOf(calendarToday());
  const athletes = await phoneAthletes(coach.id);
  const names = new Map(athletes.map((a) => [a.id, a.name]));
  const meets = await prisma.meet.findMany({
    where: { athleteId: { in: athletes.map((a) => a.id) } },
    orderBy: { date: "asc" },
    select: { id: true, athleteId: true, name: true, date: true, federation: true, weightClass: true },
  });
  const checklist = await prisma.meetTask.findMany({ where: { meetId: { in: meets.map((m) => m.id) }, deletedAt: null }, select: { meetId: true, done: true } });
  const coming = meets.filter((m) => ymdOf(m.date) >= today);
  const past = meets.filter((m) => ymdOf(m.date) < today).reverse().slice(0, 6);

  const row = (m: (typeof meets)[number], ahead: boolean) => {
    const days = daysBetween(today, ymdOf(m.date));
    const tasks = checklist.filter((x) => x.meetId === m.id);
    const done = tasks.filter((x) => x.done).length;
    return (
      <li key={m.id}>
        <Link href={`/a/coach/${m.athleteId}/meet?meet=${m.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 active:bg-surface-2">
          <span className={`w-12 shrink-0 text-center ${ahead ? "text-accent" : "text-muted"}`}>
            <span className="block text-[22px] font-bold tabular-nums">{ahead ? days : formatDate(ymdOf(m.date)).split(" ")[0]}</span>
            <span className="block text-[11px]">{ahead ? t("days") : formatDate(ymdOf(m.date)).split(" ").slice(1).join(" ")}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{m.name}</span>
            <span className="block truncate text-[12px] text-muted">
              {[names.get(m.athleteId), m.federation, m.weightClass, ahead && tasks.length > 0 ? t("{done}/{of} checklist", { done, of: tasks.length }) : null].filter(Boolean).join(" · ")}
            </span>
          </span>
        </Link>
      </li>
    );
  };

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-[26px] font-bold tracking-tight">{t("Meets")}</h1>
      {meets.length === 0 && <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-[14px] text-muted">{t("No meets yet. Add one from an athlete's Meet page.")}</p>}
      {coming.length > 0 && (
        <section className="flex flex-col gap-2">
          <Heading>{t("COMING UP")}</Heading>
          <ul className="flex flex-col gap-2">{coming.map((m) => row(m, true))}</ul>
        </section>
      )}
      {past.length > 0 && (
        <section className="flex flex-col gap-2">
          <Heading>{t("DONE")}</Heading>
          <ul className="flex flex-col gap-2">{past.map((m) => row(m, false))}</ul>
        </section>
      )}
    </main>
  );
}
