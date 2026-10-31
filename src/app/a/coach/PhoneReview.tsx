"use client";

import { useMemo, useState, useTransition } from "react";
import { useCoachActions } from "@/components/CoachActions";
import { PhoneClips } from "@/components/PhoneClips";
import { readinessOf } from "@/lib/checkins";
import { dayStatus, daySets, offPlan, rowSets } from "@/lib/compliance";
import { formatDate, weekdayOf } from "@/lib/dates";
import { volumeText } from "@/lib/duration";
import { t, weekdayShort } from "@/lib/i18n";
import { estimate1RM, formatPrescription, maxesOf, resolveDay, rpeTableFor } from "@/lib/intensity";
import type { AthleteCheckins, MessageData } from "@/lib/queries";
import { sessionDate } from "@/lib/schedule";
import { formatEffort, formatSet } from "@/lib/setlog";
import { topSetOf, unreviewedDays, type PreviousLog } from "@/lib/tracking";
import type { AthleteData, BlockData, RowData } from "@/lib/types";

type Filter = "all" | "unreviewed" | "offplan" | "missed" | "prs";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unreviewed", label: "To review" },
  { id: "offplan", label: "Off plan" },
  { id: "missed", label: "Missed" },
  { id: "prs", label: "PRs" },
];

/** "180 × 5 5 5 @8 8.5" when every set was the same weight, else each set in turn. */
function doneText(row: RowData, unit: string): string | null {
  const done = (row.logs ?? []).filter((l) => l.done);
  if (done.length === 0) return row.actualWeight === null ? null : `${row.actualWeight} ${unit}${row.performedRpe !== null ? ` @${row.performedRpe}` : ""}`;
  if (row.duration !== null || new Set(done.map((l) => l.weight)).size > 1) return done.map((l) => formatSet(l)).join(", ");
  const efforts = done.map((l) => formatEffort(l).replace("@", "")).filter(Boolean);
  return `${done[0].weight ?? "—"} × ${done.map((l) => l.reps ?? "—").join(" ")}${efforts.length ? ` @${efforts.join(" ")}` : ""}`;
}

/**
 * Review on the coach's phone: a week strip of sessions, one session at a time below it —
 * each exercise's plan, what was done and its e1RM, opening to the sets, the athlete's note
 * and videos — and the note and Reviewed mark pinned at the bottom. Filters sit in a sheet.
 */
export function PhoneReview({
  block,
  athlete,
  today,
  initialWeek,
  checkins,
  messages: initialMessages,
  moves,
  previous,
}: {
  block: BlockData;
  athlete: AthleteData;
  today: string;
  initialWeek: number;
  checkins: AthleteCheckins;
  messages: MessageData[];
  moves: Record<string, string>;
  previous: Record<string, PreviousLog>;
}) {
  const { markReviewed, sendMessage, deleteMessage, clips } = useCoachActions();
  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const moveMap = useMemo(() => new Map(Object.entries(moves)), [moves]);
  const [weekNo, setWeekNo] = useState(Math.min(Math.max(1, initialWeek), block.weeks.length));
  const [reviewed, setReviewed] = useState<Record<string, string | null>>({});
  const [messages, setMessages] = useState(initialMessages);
  const [synced, setSynced] = useState(initialMessages);
  const [filter, setFilter] = useState<Filter>("all");
  const [sheet, setSheet] = useState(false);
  const [everySet, setEverySet] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (synced !== initialMessages) {
    setSynced(initialMessages);
    setMessages(initialMessages);
  }

  const maxes = maxesOf(block, athlete);
  const table = rpeTableFor(athlete);
  const unreviewed = useMemo(() => unreviewedDays(block, checkins.answers, moveMap), [block, checkins.answers, moveMap]);
  const week = block.weeks.find((w) => w.order === weekNo) ?? block.weeks[0];

  const days = week.days.map((day) => {
    const ymd = sessionDate(block.startDate, week.order, day, moveMap);
    const rows = day.rows.filter((r) => r.exercise.trim() !== "").sort((a, b) => a.order - b.order);
    const training = !day.rest && rows.length > 0;
    const sets = daySets(rows);
    const status = dayStatus(ymd, today, training ? sets : null, true);
    const targets = resolveDay(rows, maxes);
    const off = rows.some((r) => offPlan(r, targets.get(r.id)?.weight ?? null, ymd < today)?.level === "warn");
    const pr = rows.some((r) => r.logs?.some((l) => l.pr));
    const isReviewed = day.id in reviewed ? reviewed[day.id] !== null : !unreviewed.has(day.id) && !!day.reviewedAt;
    const toReview = day.id in reviewed ? reviewed[day.id] === null && unreviewed.has(day.id) : unreviewed.has(day.id);
    const match = filter === "all" || (filter === "unreviewed" ? toReview : filter === "offplan" ? off : filter === "missed" ? status === "missed" : pr);
    return { day, ymd, rows, training, sets, status, targets, off, pr, isReviewed, toReview, match };
  });
  const pickDefault = () => (days.find((d) => d.ymd === today && d.training) ?? days.find((d) => d.toReview) ?? days.find((d) => d.training) ?? days[0])?.day.id;
  const [picked, setPicked] = useState<string | undefined>(pickDefault);
  const s = days.find((d) => d.day.id === picked) ?? days.find((d) => d.day.id === pickDefault())!;

  const answers = checkins.answers.filter((a) => a.day === s.ymd);
  const readiness = answers.length ? readinessOf(checkins.questions, answers).score : null;
  const notes = messages.filter((m) => m.dayId === s.day.id && m.sender === "coach");
  const videos = s.rows.reduce((n, r) => n + (clips[r.id]?.length ?? 0), 0);

  function goWeek(by: number) {
    const next = Math.min(Math.max(1, weekNo + by), block.weeks.length);
    setWeekNo(next);
    setPicked(undefined);
  }

  function run(write: () => Promise<void>) {
    setError(null);
    start(async () => {
      try {
        await write();
      } catch (e) {
        setError(t(e instanceof Error ? e.message : "Something went wrong."));
      }
    });
  }

  function submit() {
    const body = draft.trim();
    if (body) {
      run(async () => {
        const { message, reviewedAt } = await sendMessage(athlete.id, s.day.id, s.ymd, body);
        setMessages((m) => [...m, message]);
        setReviewed((r) => ({ ...r, [s.day.id]: reviewedAt }));
        setDraft("");
      });
    } else {
      const on = !s.isReviewed;
      setReviewed((r) => ({ ...r, [s.day.id]: on ? new Date().toISOString() : null }));
      run(async () => void (await markReviewed([s.day.id], on)));
    }
  }

  const chip = s.isReviewed
    ? { text: t("Reviewed"), cls: "bg-ok/15 text-ok" }
    : s.status === "missed"
      ? { text: t("missed"), cls: "bg-miss/15 text-miss" }
      : s.toReview
        ? { text: t("to review"), cls: "bg-accent-soft text-accent" }
        : s.status === "upcoming" || s.status === "today"
          ? { text: t("Still to come"), cls: "bg-surface-2 text-muted" }
          : null;
  const DOT: Record<string, string> = { done: "bg-ok", partial: "bg-warn", missed: "bg-miss", today: "bg-foreground", upcoming: "bg-muted-2", rest: "bg-transparent", none: "bg-transparent" };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => goWeek(-1)} disabled={weekNo <= 1} aria-label={t("Previous week")} className="grid size-11 place-items-center rounded-full text-[20px] text-muted disabled:opacity-30">
          ‹
        </button>
        <span className="text-[14px] font-semibold">{t("Week {n}", { n: week.order })}</span>
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => goWeek(1)} disabled={weekNo >= block.weeks.length} aria-label={t("Next week")} className="grid size-11 place-items-center rounded-full text-[20px] text-muted disabled:opacity-30">
            ›
          </button>
          <button type="button" onClick={() => setSheet(true)} className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] ${filter === "all" ? "border-border text-muted" : "border-accent text-accent"}`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            {filter === "all" ? t("Filter") : t(FILTERS.find((f) => f.id === filter)!.label)}
          </button>
        </span>
      </div>

      <div role="group" aria-label={t("Session")} className="grid grid-cols-7 gap-1" data-no-swipe>
        {days.map((d) => (
          <button
            key={d.day.id}
            type="button"
            onClick={() => setPicked(d.day.id)}
            aria-pressed={d.day.id === s.day.id}
            className={`flex h-14 flex-col items-center justify-center gap-1 rounded-xl border ${d.day.id === s.day.id ? "border-accent bg-accent-soft" : "border-border bg-surface"} ${d.match ? "" : "opacity-35"}`}
          >
            <span className="text-[11px] text-muted">{weekdayShort(weekdayOf(d.ymd)).slice(0, 2)}</span>
            <span className="text-[14px] font-semibold tabular-nums">{Number(d.ymd.slice(8, 10))}</span>
            <span aria-hidden className={`size-1.5 rounded-full ${d.toReview ? "bg-accent" : DOT[d.status]}`} />
          </button>
        ))}
      </div>

      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] text-muted">
            {weekdayShort(weekdayOf(s.ymd))} {formatDate(s.ymd)}
            {s.ymd === today && ` · ${t("today")}`}
          </p>
          <h2 className="truncate text-[20px] font-bold">{s.training ? s.day.label : t("Rest day")}</h2>
        </div>
        {chip && <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${chip.cls}`}>{chip.text}</span>}
      </div>
      {s.training && (
        <div className="flex flex-wrap gap-1.5">
          {readiness !== null && <Fact warn={readiness <= 2}>{t("Readiness {n}/5", { n: readiness })}</Fact>}
          <Fact>{t("{done}/{of} sets done", { done: s.sets.done, of: s.sets.prescribed })}</Fact>
          {s.pr && <Fact pr>{t("PRs")}</Fact>}
          {videos > 0 && <Fact>{t(videos === 1 ? "{n} video" : "{n} videos", { n: videos })}</Fact>}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {s.rows.map((row) => {
          const target = s.targets.get(row.id)?.weight ?? null;
          const done = doneText(row, unit);
          const top = topSetOf(row);
          const e1rm = top ? estimate1RM(top.weight, top.reps, top.rpe, athlete.unit, table) : null;
          const prev = previous[row.id]?.e1rm ?? null;
          const delta = e1rm !== null && prev !== null ? Math.round((e1rm - prev) * 10) / 10 : null;
          const pr = row.logs?.some((l) => l.pr);
          const isOpen = everySet || open.has(row.id);
          const { done: setsDone } = rowSets(row);
          return (
            <li key={row.id}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => (o.has(row.id) ? new Set([...o].filter((x) => x !== row.id)) : new Set([...o, row.id])))}
                className="flex w-full flex-col gap-1 rounded-2xl border border-border bg-surface px-3.5 py-3 text-left"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15px] font-semibold">{row.exercise}</span>
                  <span className={`shrink-0 text-[13px] tabular-nums ${pr ? "text-pr" : delta !== null && delta > 0 ? "text-ok" : "text-muted"}`}>
                    {[pr ? t("PR") : null, e1rm !== null ? `${t("e1RM")} ${e1rm}${delta ? ` ${delta > 0 ? "+" : ""}${delta}` : ""}` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="text-[13px] text-muted">
                  {volumeText(row)} @ {formatPrescription(row, athlete.unit)}
                  {target !== null && row.intensityType !== "WEIGHT" && ` · ${target} ${unit}`}
                </span>
                <span className={`text-[15px] tabular-nums ${done ? "text-foreground" : s.ymd < today ? "text-miss" : "text-muted-2"}`}>
                  {done ?? (s.ymd < today ? t("not done") : "—")}
                </span>
              </button>
              {isOpen && (
                <div className="mx-2 flex flex-col gap-2 rounded-b-2xl border border-t-0 border-border bg-surface-2/50 px-3 py-2.5 text-[13px]">
                  {(row.logs ?? []).map((l) => (
                    <div key={l.setIndex} className="flex justify-between tabular-nums">
                      <span className="text-muted">{t("Set {n}", { n: l.setIndex + 1 })}</span>
                      <span className={l.done ? "" : "text-muted-2"}>
                        {formatSet(l)} {l.done ? "✓" : ""} {l.pr ? t("PR") : ""}
                      </span>
                    </div>
                  ))}
                  {(row.logs ?? []).length === 0 && <span className="text-muted-2">{setsDone > 0 ? done : t("No sets logged.")}</span>}
                  {previous[row.id] && (
                    <span className="text-muted-2">
                      {t("Last time ({date})", { date: formatDate(previous[row.id].ymd) })}: {previous[row.id].weight} {unit}
                      {previous[row.id].reps !== null && ` × ${previous[row.id].reps}`}
                    </span>
                  )}
                  {row.athleteNotes && <span className="italic text-muted">“{row.athleteNotes}”</span>}
                  {(clips[row.id]?.length ?? 0) > 0 && <PhoneClips clips={clips[row.id]} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {notes.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {notes.map((m) => (
            <li key={m.id} className="flex items-start gap-2 rounded-2xl bg-accent-soft px-3.5 py-2.5 text-[14px]">
              <span className="min-w-0 flex-1 whitespace-pre-wrap">{m.body}</span>
              <button
                type="button"
                onClick={() => {
                  setMessages((list) => list.filter((x) => x.id !== m.id));
                  run(() => deleteMessage(m.id));
                }}
                className="shrink-0 text-[12px] text-muted"
              >
                {t("Delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-[13px] text-miss">{error}</p>}

      {s.training && s.status !== "upcoming" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] -mx-4 mt-1 flex gap-2 border-t border-border bg-background px-4 py-2.5"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("Note for {name}", { name: athlete.name.split(" ")[0] })}
            aria-label={t("Note for {name}", { name: athlete.name.split(" ")[0] })}
            className="h-12 min-w-0 flex-1 rounded-2xl border border-border bg-surface px-3.5 text-[15px] outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending}
            className={`h-12 shrink-0 rounded-2xl px-4 text-[14px] font-semibold text-white disabled:opacity-60 ${s.isReviewed && !draft.trim() ? "bg-ok/80" : "bg-accent"}`}
          >
            {draft.trim() ? t("Send") : s.isReviewed ? `✓ ${t("Reviewed")}` : t("Mark reviewed")}
          </button>
        </form>
      )}

      {sheet && (
        <div className="fixed inset-0 z-30 flex flex-col justify-end bg-black/55" role="dialog" aria-label={t("Filter")}>
          <button type="button" aria-label={t("Close")} onClick={() => setSheet(false)} className="flex-1" />
          <div className="flex flex-col gap-4 rounded-t-3xl bg-surface px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-3">
            <span aria-hidden className="mx-auto h-1 w-10 rounded-full bg-border" />
            <span className="text-[17px] font-semibold">{t("Show sessions")}</span>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => {
                    setFilter(f.id);
                    const first = days.find((d) => f.id === "all" || (f.id === "unreviewed" ? d.toReview : f.id === "offplan" ? d.off : f.id === "missed" ? d.status === "missed" : d.pr));
                    if (first) setPicked(first.day.id);
                  }}
                  className={`h-10 rounded-full border px-4 text-[14px] ${filter === f.id ? "border-accent bg-accent-soft text-accent" : "border-border"}`}
                >
                  {t(f.label)}
                </button>
              ))}
            </div>
            <label className="flex min-h-11 items-center justify-between text-[15px]">
              {t("Every set")}
              <input type="checkbox" checked={everySet} onChange={(e) => setEverySet(e.target.checked)} className="size-5 accent-[var(--accent)]" />
            </label>
            <button type="button" onClick={() => setSheet(false)} className="h-12 rounded-2xl bg-accent text-[15px] font-semibold text-white">
              {t("Done")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Fact({ children, warn = false, pr = false }: { children: React.ReactNode; warn?: boolean; pr?: boolean }) {
  return (
    <span className={`flex h-7 items-center rounded-full px-2.5 text-[12px] ${warn ? "bg-warn/15 text-warn" : pr ? "bg-pr/15 text-pr" : "bg-surface-2 text-muted"}`}>{children}</span>
  );
}
