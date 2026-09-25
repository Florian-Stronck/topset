"use client";

import type { Unit } from "@prisma/client";
import Link from "next/link";
import { useState } from "react";
import { BodyweightCard } from "@/components/athlete/BodyweightCard";
import { Check } from "@/components/athlete/icons";
import { ReadinessCard } from "@/components/athlete/ReadinessCard";
import { SessionLogger } from "@/components/athlete/SessionLogger";
import type { AthleteSession } from "@/lib/athlete-queries";
import type { BodyweightEntry } from "@/lib/bodyweight";
import type { ReadinessEntry } from "@/lib/readiness";
import { t } from "@/lib/i18n";
import { completion } from "@/lib/setlog";

export type StripDay = {
  ymd: string;
  letter: string;
  title: string;
  href: string;
  training: boolean;
  status: "done" | "partial" | "none";
};

type Step = { prev: string | null; next: string | null };

/**
 * One day of the plan, the way the athlete finds it: the phase and week it sits in, the
 * week's days as a strip, and the session itself. The day being logged keeps the strip's
 * tick and the week's count current as sets go in.
 */
export function CheckinDay({
  token,
  unit,
  today,
  day,
  athlete,
  program,
  phase,
  week,
  strip,
  heading,
  session,
  rest,
  bodyweight,
  readiness,
}: {
  token: string;
  unit: Unit;
  today: string;
  day: string;
  athlete: string;
  program: string;
  phase: Step & { name: string };
  week: Step & { n: number; of: number };
  strip: StripDay[];
  heading: { weekday: string; label: string | null; long: string };
  session: AthleteSession | null;
  rest: { next: { href: string; date: string } | null; todayHref: string | null };
  /** Recent weigh-ins, newest first. */
  bodyweight: BodyweightEntry[];
  /** The day's readiness check-in, when the coach asks for one that day; undefined when not. */
  readiness?: { entry: ReadinessEntry | null };
}) {
  const [live, setLive] = useState<StripDay["status"] | null>(null);
  const days = strip.map((d) => (d.ymd === day && live ? { ...d, status: live } : d));
  const training = days.filter((d) => d.training);
  const logged = training.filter((d) => d.status === "done").length;

  return (
    <div>
      <div className="truncate text-center text-[12px] text-muted-2">
        {athlete} · {program}
      </div>

      {/* Phase and week on one row, each with its own steps back and forward. */}
      <div className="mt-3 flex items-center rounded-2xl border border-border bg-surface">
        <div className="flex min-w-0 flex-1 items-center">
          <Arrow href={phase.prev} label={t("Previous phase")} dir="left" small />
          <h1 className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold tracking-tight">{phase.name}</h1>
          <Arrow href={phase.next} label={t("Next phase")} dir="right" small />
        </div>
        <span aria-hidden className="h-7 w-px shrink-0 bg-border" />
        <div className="flex shrink-0 items-center">
          <Arrow href={week.prev} label={t("Previous week")} dir="left" small />
          <div className="text-center leading-tight">
            <div className="text-[14px] font-medium tabular-nums">{t("Week {n}/{of}", { n: week.n, of: week.of })}</div>
            <div className="text-[11px] tabular-nums text-muted">
              {t("{done}/{of} logged", { done: logged, of: training.length })}
            </div>
          </div>
          <Arrow href={week.next} label={t("Next week")} dir="right" small />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 place-items-center">
        {days.map((d) => (
          <Link
            key={d.ymd}
            href={d.href}
            title={d.title}
            aria-current={d.ymd === day ? "date" : undefined}
            className="relative grid h-12 w-12 place-items-center"
          >
            <span
              className={`grid h-10 w-10 place-items-center rounded-full text-[14px] font-medium ${
                d.training ? "bg-foreground text-background" : "text-muted"
              } ${d.ymd === day ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : ""}`}
            >
              {d.letter}
            </span>
            {d.training && d.status === "done" && (
              <span className="absolute bottom-0.5 right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-background bg-ok text-black">
                <Check size={10} />
              </span>
            )}
            {d.training && d.status === "partial" && (
              <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent" />
            )}
            {d.ymd === today && d.ymd !== day && <span className="absolute -bottom-1 h-1 w-1 rounded-full bg-accent" />}
          </Link>
        ))}
      </div>

      <div className="mt-5 flex items-baseline justify-between gap-3">
        <div className="min-w-0 truncate text-[15px]">
          <span className="font-medium">{heading.weekday}</span>
          <span className="text-muted"> · {heading.label ?? t("Rest day")}</span>
        </div>
        {day === today ? (
          <span className="shrink-0 text-[13px] font-medium text-accent">{t("Today")}</span>
        ) : (
          rest.todayHref && (
            <Link href={rest.todayHref} className="shrink-0 text-[13px] text-accent">
              {t("Back to today")}
            </Link>
          )
        )}
      </div>

      {/* A future day can't be weighed yet: that one logs today. */}
      <BodyweightCard token={token} unit={unit} day={day <= today ? day : today} today={today} entries={bodyweight} />
      {readiness && <ReadinessCard token={token} day={day} initial={readiness.entry} />}

      {session ? (
        <SessionLogger
          token={token}
          unit={unit}
          session={session}
          onProgress={(done, prescribed) => setLive(completion(done, prescribed))}
        />
      ) : (
        <div className="mt-4 rounded-2xl border border-border bg-surface px-5 py-8 text-center">
          <div className="text-[16px] font-medium">{t("Rest day")}</div>
          <p className="mt-1 text-[13px] text-muted">
            {rest.next ? t("Next session: {date}", { date: rest.next.date }) : t("Nothing else is planned yet.")}
          </p>
          {rest.next && (
            <Link
              href={rest.next.href}
              className="mt-4 inline-block rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white"
            >
              {t("See it")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Arrow({ href, label, dir, small = false }: { href: string | null; label: string; dir: "left" | "right"; small?: boolean }) {
  const size = small ? 16 : 22;
  const icon = (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
  const cls = `grid ${small ? "h-10 w-9" : "h-10 w-10"} shrink-0 place-items-center rounded-full`;
  if (!href) return <span className={`${cls} text-muted-2 opacity-30`} aria-hidden>{icon}</span>;
  return (
    <Link href={href} aria-label={label} title={label} className={`${cls} text-muted active:bg-surface-3`}>
      {icon}
    </Link>
  );
}
