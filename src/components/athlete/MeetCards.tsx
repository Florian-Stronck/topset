"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import * as actions from "@/app/a/actions";
import { synced } from "@/components/athlete/WriteSync";
import { longDate, meetTimes, shortDate } from "@/lib/athlete-format";
import type { MeetView } from "@/lib/athlete-queries";
import { LIFT_LABEL, MEET_LIFTS } from "@/lib/competition";
import { t } from "@/lib/i18n";
import { daysBetween } from "@/lib/schedule";

const tickMeetTask = synced(actions.tickMeetTask);
const logBodyweight = synced(actions.logBodyweight);

/** Where the athlete stands against the class: the 7-day average and the limit, when known. */
export type WeightView = { current: number | null; limit: number | null };

const opener = (meet: MeetView, lift: (typeof MEET_LIFTS)[number]) => meet.attempts?.find((a) => a.lift === lift && a.number === 1)?.weight ?? null;

/** Today's way into the meet: the countdown and what still needs doing. */
export function MeetCard({ token, meet, today, weight }: { token: string; meet: MeetView; today: string; weight: WeightView }) {
  const days = daysBetween(today, meet.ymd);
  const mine = meet.tasks.filter((x) => x.owner === "athlete");
  const openers = MEET_LIFTS.map((l) => opener(meet, l)).filter((w): w is number => w !== null);
  const chip = "min-w-0 flex-1 rounded-xl bg-surface-2 px-2.5 py-2 text-[12px]";
  return (
    <Link href={`/a/${token}/meet`} className="mb-4 block rounded-2xl border border-accent/45 bg-surface px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{meet.name}</span>
        <svg className="ml-auto shrink-0 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m9 6 6 6-6 6" />
        </svg>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[38px] font-bold leading-none tracking-tight">{days}</span>
        <span className="text-[14px] text-muted">{t(days === 1 ? "day · {date}" : "days · {date}", { date: shortDate(meet.ymd) })}</span>
      </div>
      {meetTimes(meet) && <div className="mt-1.5 text-[13px]">{meetTimes(meet)}</div>}
      <div className="mt-2.5 flex gap-1.5">
        {openers.length > 0 && (
          // Three weights on one line: this chip takes the room it needs, the others share the rest.
          <span className={`${chip} !flex-none`}>
            <span className="block text-[11px] text-muted">{t("Openers")}</span>
            <span className="whitespace-nowrap font-semibold">{openers.join(" · ")}</span>
          </span>
        )}
        {mine.length > 0 && (
          <span className={chip}>
            <span className="block text-[11px] text-muted">{t("Your list")}</span>
            <span className="font-semibold">{t("{n} left", { n: mine.filter((x) => !x.done).length })}</span>{" "}
            <span className="text-muted">{t("of {n}", { n: mine.length })}</span>
          </span>
        )}
        {weight.limit !== null && weight.current !== null && (
          <span className={chip}>
            <span className="block text-[11px] text-muted">{t("Class {n}", { n: weight.limit })}</span>
            <span className={`font-semibold ${weight.current > weight.limit ? "text-warn" : "text-ok"}`}>{weight.current}</span>
          </span>
        )}
      </div>
    </Link>
  );
}

/** Meet day, and weigh-in day when it's the day before: the times, the weigh-in, the openers and racks. */
export function MeetMorning({ token, meet, today, unit }: { token: string; meet: MeetView; today: string; unit: string }) {
  const weighIn = today === meet.weighInDay;
  const lifting = today === meet.ymd;
  const times = [
    weighIn && meet.weighInTime && { time: meet.weighInTime, what: t("Weigh-in"), sub: t("Bring your federation card and ID.") },
    lifting && (meet.startTime || meet.session) && { time: meet.startTime ?? "", what: meet.session ?? t("Lifting"), sub: t("Squat, then bench, then deadlift") },
  ].filter((x): x is { time: string; what: string; sub: string } => Boolean(x));
  const racks: Record<(typeof MEET_LIFTS)[number], string> = {
    SQUAT: [meet.racks.squat && t("rack {n}", { n: meet.racks.squat }), meet.racks.safety && t("safeties {n}", { n: meet.racks.safety })].filter(Boolean).join(" · "),
    BENCH: meet.racks.bench ? t("rack {n}", { n: meet.racks.bench }) : "",
    DEADLIFT: "",
  };
  const lifts = MEET_LIFTS.filter((l) => opener(meet, l) !== null || racks[l]);

  return (
    <div className="mb-4 space-y-3">
      <header>
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">{lifting ? t("Meet day") : t("Weigh-in day")}</div>
        <h1 className="text-[22px] font-bold tracking-tight">{meet.name}</h1>
        <div className="text-[13px] text-muted">{[longDate(meet.ymd), meet.venue].filter(Boolean).join(" · ")}</div>
      </header>
      {times.length > 0 && (
        <section className="divide-y divide-border rounded-2xl border border-border bg-surface px-4">
          {times.map((x) => (
            <div key={x.what} className="flex gap-3.5 py-3">
              <span className="w-12 shrink-0 text-[16px] font-bold text-accent">{x.time}</span>
              <span className="text-[14px]">
                {x.what}
                <span className="block text-[12px] text-muted">{x.sub}</span>
              </span>
            </div>
          ))}
        </section>
      )}
      {weighIn && <WeighIn token={token} today={today} unit={unit} />}
      {lifts.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
          <h2 className="text-[11px] font-semibold tracking-[0.14em] text-muted">
            {meet.attempts ? t("OPENERS AND RACKS") : t("RACK HEIGHTS")}
            {meet.rackBrand && ` · ${meet.rackBrand.toUpperCase()}`}
          </h2>
          {lifts.map((l) => (
            <div key={l} className="flex min-h-12 items-center gap-3 rounded-xl bg-surface-2 px-3">
              <span className="flex-1 text-[15px]">{t(LIFT_LABEL[l])}</span>
              <span className="text-[12px] text-muted">{racks[l]}</span>
              {opener(meet, l) !== null && <span className="w-16 text-right text-[22px] font-bold text-accent">{opener(meet, l)}</span>}
            </div>
          ))}
        </section>
      )}
      <Link href={`/a/${token}/meet`} className="flex min-h-12 items-center justify-center rounded-2xl border border-border text-[14px]">
        {t("Full plan and your list")}
      </Link>
    </div>
  );
}

/** The weight at weigh-in, which goes to the coach for the meet score. */
function WeighIn({ token, today, unit }: { token: string; today: string; unit: string }) {
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const weight = Number(draft.replace(",", "."));
  const valid = draft.trim() !== "" && Number.isFinite(weight) && weight > 0;
  const save = () => {
    if (!valid || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await logBodyweight(token, today, weight);
        setSaved(weight);
        setDraft("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };
  return (
    <section className="space-y-2 rounded-2xl border border-accent/45 bg-surface p-4">
      <label htmlFor="weighed-in" className="text-[11px] font-semibold tracking-[0.14em] text-muted">
        {t("WEIGHED IN AT")}
      </label>
      {saved !== null ? (
        <p className="text-[15px]">
          <span className="font-semibold">
            {saved} {unit}
          </span>{" "}
          <span className="text-muted">{t("sent to your coach")}</span>
        </p>
      ) : (
        <div className="flex gap-2">
          <input
            id="weighed-in"
            inputMode="decimal"
            value={draft}
            placeholder={unit}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            className="h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3.5 text-[18px] outline-none focus:border-accent"
          />
          <button type="button" disabled={!valid || pending} onClick={save} className="h-12 rounded-xl bg-accent px-5 text-[15px] font-semibold text-white disabled:opacity-50">
            {t("Save")}
          </button>
        </div>
      )}
      {error && <p className="text-[12px] text-miss">{error}</p>}
      <p className="text-[12px] text-muted">{t("Goes straight to your coach for your score.")}</p>
    </section>
  );
}

/** The athlete ticks their own things off; the coach's show, but stay the coach's to tick. */
export function MeetTasks({ token, tasks }: { token: string; tasks: MeetView["tasks"] }) {
  const [list, setList] = useState(tasks);
  const [, startTransition] = useTransition();
  const mine = list.filter((x) => x.owner === "athlete");
  const theirs = list.filter((x) => x.owner === "coach");
  const tick = (id: string, done: boolean) => {
    setList((was) => was.map((x) => (x.id === id ? { ...x, done } : x)));
    startTransition(() => {
      void tickMeetTask(token, id, done);
    });
  };
  if (list.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      {mine.length > 0 && (
        <>
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold tracking-[0.14em] text-muted">{t("YOUR LIST")}</h2>
            <span className="text-[12px] text-muted">{t("{done} of {n} done", { done: mine.filter((x) => x.done).length, n: mine.length })}</span>
          </div>
          {mine.map((x) => (
            <label key={x.id} className={`flex min-h-11 items-center gap-3 text-[15px] ${x.done ? "text-muted line-through" : ""}`}>
              <input type="checkbox" checked={x.done} onChange={() => tick(x.id, !x.done)} className="size-[22px] shrink-0 accent-[var(--accent)]" />
              {x.text}
            </label>
          ))}
        </>
      )}
      {theirs.length > 0 && (
        <div className={mine.length > 0 ? "mt-2 border-t border-border pt-2.5" : ""}>
          <h2 className="mb-1 text-[11px] font-semibold tracking-[0.14em] text-muted">{t("YOUR COACH IS SORTING")}</h2>
          {theirs.map((x) => (
            <div key={x.id} className={`flex min-h-9 items-center gap-3 text-[14px] ${x.done ? "text-muted" : ""}`}>
              <span className={`grid size-[22px] shrink-0 place-items-center rounded-md text-[13px] font-bold ${x.done ? "bg-ok text-background" : "bg-border"}`}>{x.done ? "✓" : ""}</span>
              {x.text}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
