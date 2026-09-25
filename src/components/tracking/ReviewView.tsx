"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { deleteMessage, editMessage, markReviewed, sendMessage } from "@/app/tracking/actions";
import { AthleteLinkButton } from "@/components/AthleteLink";
import { Trophy } from "@/components/CheckinIcon";
import { RowVideos } from "@/components/RowVideos";
import { formatAnswer, LOW_READINESS, readinessOf, type CheckinAnswerData, type CheckinQuestionData } from "@/lib/checkins";
import { dayStatus, daySets, offPlan, rowSets, rpeDelta, type DayStatus, type OffPlan } from "@/lib/compliance";
import { formatDate, weekdayOfDay } from "@/lib/dates";
import { useCommands, type Command } from "@/lib/commands";
import { t, weekdayShort } from "@/lib/i18n";
import { estimate1RM, formatPrescription, maxesOf, resolveDay } from "@/lib/intensity";
import { setTrackingPref, usePref } from "@/lib/prefs";
import type { AthleteCheckins, MessageData } from "@/lib/queries";
import { dateOfDay } from "@/lib/schedule";
import { formatEffort } from "@/lib/setlog";
import {
  attentionOf,
  keepRow,
  keepSession,
  LIFT_FILTERS,
  needsReview,
  REVIEW_FILTERS,
  sessionActivity,
  topSetOf,
  weekStats,
  type LiftFilter,
  type PreviousLog,
  type ReviewFilter,
  type RowFacts,
  type SessionFacts,
  type TopSet,
} from "@/lib/tracking";
import type { AthleteData, BlockData, DayData, RowData } from "@/lib/types";
import type { VideoFile } from "@/lib/videos";

const FILTER_LABEL: Record<ReviewFilter, string> = {
  all: "All",
  unreviewed: "To review",
  offplan: "Off plan",
  missed: "Missed",
  prs: "PRs",
};

const LIFT_LABEL: Record<LiftFilter, string> = {
  all: "Every exercise",
  main: "Competition lifts",
  variations: "Variations",
  accessories: "Accessories",
};

const STATUS_COLOR: Record<DayStatus, string> = {
  done: "var(--ok)",
  partial: "var(--warn)",
  missed: "var(--miss)",
  today: "var(--accent)",
  upcoming: "transparent",
  rest: "transparent",
  none: "transparent",
};

const STATUS_LABEL: Record<DayStatus, string> = {
  done: "Done",
  partial: "Partly done",
  missed: "Missed",
  today: "Today",
  upcoming: "Still to come",
  rest: "Rest",
  none: "",
};

type Line = {
  row: RowData;
  target: number | null;
  off: OffPlan | null;
  pr: boolean;
  top: TopSet | null;
  e1rm: number | null;
  previous: PreviousLog | null;
  facts: RowFacts;
};

type Session = {
  day: DayData;
  ymd: string;
  weekday: number;
  status: DayStatus;
  lines: Line[];
  kept: Line[];
  answers: CheckinAnswerData[];
  readiness: { score: number | null; low: { label: string; value: string }[] };
  unreviewed: boolean;
  messages: MessageData[];
  facts: SessionFacts;
};

/**
 * Review: the open week's sessions, one card each, every exercise on one line — the plan,
 * what was done, the 1RM it implies against last time — opening to its sets, notes and
 * videos. The coach marks a session reviewed, or writes the athlete a note about it, which
 * marks it too. Filters and a count of what needs attention sit on top.
 */
export function ReviewView({
  block: initialBlock,
  athlete,
  initialWeek,
  today,
  videos,
  checkins,
  messages: initialMessages,
  previous,
  show,
  hasLink,
}: {
  block: BlockData;
  athlete: AthleteData;
  initialWeek: number;
  /** `YYYY-MM-DD` on this computer. */
  today: string;
  videos: Record<string, VideoFile[]>;
  checkins: AthleteCheckins;
  /** The coach's notes to this athlete, oldest first. */
  messages: MessageData[];
  /** Per row, the last earlier time its exercise was logged. */
  previous: Record<string, PreviousLog>;
  /** A filter asked for in the link (from Overview, say). */
  show: ReviewFilter | null;
  hasLink: boolean;
}) {
  const [block, setBlock] = useState(initialBlock);
  const [messages, setMessages] = useState(initialMessages);
  const [synced, setSynced] = useState({ block: initialBlock, messages: initialMessages });
  const [week, setWeekState] = useState(initialWeek);
  const [focused, setFocused] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const [, startTransition] = useTransition();
  const prefs = usePref("tracking");
  const attentionRef = useRef<HTMLDivElement>(null);

  // Fresh data from the server (a refresh, or an action's revalidation) replaces ours.
  if (synced.block !== initialBlock || synced.messages !== initialMessages) {
    if (synced.block.id !== initialBlock.id) setWeekState(initialWeek);
    setSynced({ block: initialBlock, messages: initialMessages });
    setBlock(initialBlock);
    setMessages(initialMessages);
  }

  // A filter in the link wins once, then the coach's own choice holds.
  useEffect(() => {
    if (!show) return;
    setTrackingPref({ filter: show });
    const params = new URLSearchParams(window.location.search);
    params.delete("show");
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [show]);

  const weekCount = block.weeks.length;
  const activeWeek = Math.min(Math.max(1, week), weekCount);
  const setWeek = (next: number | ((w: number) => number)) => {
    setWeekState((w) => {
      const value = Math.min(Math.max(1, typeof next === "function" ? next(w) : next), weekCount);
      const params = new URLSearchParams(window.location.search);
      params.set("week", String(value));
      window.history.replaceState(null, "", `?${params.toString()}`);
      return value;
    });
  };

  const unit = athlete.unit === "LB" ? "lb" : "kg";
  const maxes = maxesOf(block, athlete);
  const questions = checkins.questions;
  const weekly = useMemo(() => new Set(questions.filter((q) => q.cadence === "WEEKLY").map((q) => q.id)), [questions]);
  const answersByDay = useMemo(() => {
    const map = new Map<string, CheckinAnswerData[]>();
    for (const a of checkins.answers) map.set(a.day, [...(map.get(a.day) ?? []), a]);
    return map;
  }, [checkins.answers]);

  /** Every session of the phase, worked out once. */
  const sessionsByWeek = useMemo(() => {
    return block.weeks.map((w) =>
      w.days
        .filter((day) => !day.rest && day.rows.some((r) => r.exercise.trim() !== ""))
        .map((day): Session => {
          const ymd = dateOfDay(block.startDate, w.order, day.index);
          const resolved = resolveDay(day.rows, maxes);
          const past = ymd < today;
          const lines = day.rows
            .filter((r) => r.exercise.trim() !== "")
            .map((row): Line => {
              const target = resolved.get(row.id)?.weight ?? null;
              const off = offPlan(row, target, past);
              const pr = row.logs?.some((l) => l.pr) ?? false;
              const top = topSetOf(row);
              return {
                row,
                target,
                off,
                pr,
                top,
                e1rm: top ? estimate1RM(top.weight, top.reps, top.rpe, athlete.unit) : null,
                previous: previous[row.id] ?? null,
                facts: { tier: row.tier, off, pr },
              };
            });
          const kept = lines.filter((l) => keepRow(l.facts, prefs.filter, prefs.lifts));
          const answers = (answersByDay.get(ymd) ?? []).filter((a) => !weekly.has(a.questionId));
          const readiness = readinessOf(questions, answers);
          const activity = sessionActivity(day, answers);
          const unreviewed = needsReview(activity.hasWork, activity.last, day.reviewedAt ?? null);
          const status = dayStatus(ymd, today, daySets(day.rows), true);
          return {
            day,
            ymd,
            weekday: weekdayOfDay(block.startDate, day.index),
            status,
            lines,
            kept,
            answers,
            readiness,
            unreviewed,
            messages: messages.filter((m) => m.dayId === day.id || (m.dayId === null && m.day === ymd)),
            facts: { status, unreviewed, kept: kept.length, readiness: readiness.score },
          };
        }),
    );
  }, [answersByDay, athlete.unit, block, maxes, messages, prefs.filter, prefs.lifts, previous, questions, today, weekly]);

  const sessions = sessionsByWeek[activeWeek - 1] ?? [];
  const shown = sessions.filter((s) => keepSession(s.facts, prefs.filter, prefs.showUpcoming));
  const attention = attentionOf(sessions.map((s) => ({ facts: s.facts, rows: s.lines.map((l) => l.facts) })));
  const stats = weekStats(block);
  const current = stats[activeWeek - 1];
  const anyLogged = block.weeks.some((w) => w.days.some((d) => d.rows.some((r) => r.actualWeight !== null || (r.logs?.length ?? 0) > 0)));
  const allSessions = sessionsByWeek.flatMap((list, i) => list.map((s) => ({ s, week: i + 1 })));

  const focusedSession = shown.find((s) => s.day.id === focused) ?? shown[0] ?? null;

  function focusSession(dayId: string, weekOf?: number) {
    if (weekOf !== undefined && weekOf !== activeWeek) setWeek(weekOf);
    setFocused(dayId);
    setCollapsed((c) => {
      const next = new Set(c);
      next.delete(dayId);
      return next;
    });
    requestAnimationFrame(() => document.getElementById(`session-${dayId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  function step(by: 1 | -1) {
    if (shown.length === 0) return;
    const at = focusedSession ? shown.findIndex((s) => s.day.id === focusedSession.day.id) : -1;
    const next = shown[Math.min(shown.length - 1, Math.max(0, at + by))];
    focusSession(next.day.id);
  }

  function setReviewed(dayIds: string[], on: boolean) {
    const stamp = on ? new Date().toISOString() : null;
    setBlock((b) => ({
      ...b,
      weeks: b.weeks.map((w) => ({ ...w, days: w.days.map((d) => (dayIds.includes(d.id) ? { ...d, reviewedAt: stamp } : d)) })),
    }));
    startTransition(async () => {
      await markReviewed(dayIds, on);
    });
  }

  function toggleCollapsed(dayId: string) {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  }

  function toggleRow(rowId: string) {
    setOpenRows((o) => {
      const next = new Set(o);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: "week-prev", group: "Week", title: t("Previous week"), run: () => setWeek((w) => w - 1) },
      { id: "week-next", group: "Week", title: t("Next week"), run: () => setWeek((w) => w + 1) },
      ...Array.from({ length: weekCount }, (_, i): Command => ({
        id: `week-${i + 1}`,
        group: "Week",
        title: t("Go to week {n}", { n: i + 1 }),
        kind: "week",
        run: () => setWeek(i + 1),
      })),
      ...allSessions.map(
        ({ s, week: w }): Command => ({
          id: `session-${s.day.id}`,
          group: "Session",
          title: `${t("Week {n}", { n: w })} · ${weekdayShort(s.weekday)} — ${s.day.label}`,
          keywords: `session ${s.ymd}`,
          kind: "week",
          run: () => focusSession(s.day.id, w),
        }),
      ),
      { id: "session-next", group: "Session", title: t("Next session"), run: () => step(1) },
      { id: "session-prev", group: "Session", title: t("Previous session"), run: () => step(-1) },
      {
        id: "session-expand",
        group: "Session",
        title: t("Expand / collapse the session"),
        run: () => focusedSession && toggleCollapsed(focusedSession.day.id),
      },
      {
        id: "session-expand-all",
        group: "Session",
        title: collapsed.size > 0 ? t("Expand every session") : t("Collapse every session"),
        run: () => setCollapsed(collapsed.size > 0 ? new Set() : new Set(shown.map((s) => s.day.id))),
      },
      {
        id: "session-videos",
        group: "Session",
        title: t("Videos for this session"),
        keywords: "video form check",
        run: () => {
          if (!focusedSession) return;
          setOpenRows((o) => new Set([...o, ...focusedSession.lines.filter((l) => (videos[l.row.id]?.length ?? 0) > 0 || l.top).map((l) => l.row.id)]));
        },
      },
      {
        id: "session-review",
        group: "Session",
        title: focusedSession && !focusedSession.unreviewed && focusedSession.day.reviewedAt ? t("Mark the session not reviewed") : t("Mark the session reviewed"),
        keywords: "review done seen",
        run: () => focusedSession && setReviewed([focusedSession.day.id], !(focusedSession.day.reviewedAt && !focusedSession.unreviewed)),
      },
      {
        id: "session-feedback",
        group: "Session",
        title: t("Write feedback for this session"),
        keywords: "message note athlete inbox comment",
        run: () => {
          if (!focusedSession) return;
          focusSession(focusedSession.day.id);
          requestAnimationFrame(() => (document.getElementById(`feedback-${focusedSession.day.id}`) as HTMLTextAreaElement | null)?.focus());
        },
      },
      {
        id: "session-next-unreviewed",
        group: "Session",
        title: t("Next session to review"),
        keywords: "review unreviewed inbox",
        run: () => {
          const at = allSessions.findIndex(({ s }) => s.day.id === focusedSession?.day.id);
          const order = [...allSessions.slice(at + 1), ...allSessions.slice(0, at + 1)];
          const next = order.find(({ s }) => s.unreviewed);
          if (next) focusSession(next.s.day.id, next.week);
        },
      },
      {
        id: "week-review-all",
        group: "Session",
        title: t("Mark the whole week reviewed"),
        run: () => setReviewed(sessions.filter((s) => s.status !== "upcoming").map((s) => s.day.id), true),
      },
      ...REVIEW_FILTERS.map(
        (f): Command => ({
          id: `track-filter-${f}`,
          group: "Filter",
          title:
            f === "all"
              ? t("Show every session")
              : f === "unreviewed"
                ? t("Show only sessions to review")
                : f === "offplan"
                  ? t("Show only off-plan exercises")
                  : f === "missed"
                    ? t("Show only missed exercises")
                    : t("Show only PRs"),
          keywords: "filter",
          run: () => setTrackingPref({ filter: f }),
        }),
      ),
      ...LIFT_FILTERS.map(
        (f): Command => ({
          id: `track-lifts-${f}`,
          group: "Filter",
          title: f === "all" ? t("Every exercise") : f === "main" ? t("Only competition lifts") : f === "variations" ? t("Only variations") : t("Only accessories"),
          keywords: "filter tier",
          run: () => setTrackingPref({ lifts: f }),
        }),
      ),
      {
        id: "track-toggle-sets",
        group: "Filter",
        title: prefs.expandAll ? t("Stop expanding every set") : t("Expand every set"),
        run: () => setTrackingPref({ expandAll: !prefs.expandAll }),
      },
      {
        id: "track-toggle-upcoming",
        group: "Filter",
        title: prefs.showUpcoming ? t("Hide sessions still to come") : t("Show sessions still to come"),
        run: () => setTrackingPref({ showUpcoming: !prefs.showUpcoming }),
      },
      {
        id: "track-toggle-cues",
        group: "Filter",
        title: prefs.showCues ? t("Hide coach notes, tempo and rest") : t("Show coach notes, tempo and rest"),
        run: () => setTrackingPref({ showCues: !prefs.showCues }),
      },
      {
        id: "track-attention",
        group: "Filter",
        title: t("Jump to what needs attention"),
        run: () => attentionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }),
      },
    ];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSessions, collapsed, focusedSession, prefs, sessions, shown, videos, weekCount, activeWeek]);
  useCommands("tracking-review", commands, 1);

  const sendFor = (s: Session) => async (body: string) => {
    const { message, reviewedAt } = await sendMessage(athlete.id, s.day.id, s.ymd, body);
    setMessages((m) => [...m, message]);
    setBlock((b) => ({
      ...b,
      weeks: b.weeks.map((w) => ({ ...w, days: w.days.map((d) => (d.id === s.day.id ? { ...d, reviewedAt } : d)) })),
    }));
  };

  return (
    <div className="mt-5">
      {!anyLogged && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{t("Nothing logged in this phase yet")}</div>
            <div className="text-[12px] text-muted">
              {t("Send {name} their check-in link and every set they log on their phone shows up here.", { name: athlete.name })}
            </div>
          </div>
          <AthleteLinkButton athleteId={athlete.id} name={athlete.name} hasLink={hasLink} />
        </div>
      )}

      <WeekTiles weeks={sessionsByWeek} stats={stats} active={activeWeek} onSelect={setWeek} />

      <div ref={attentionRef} className="mt-4 flex scroll-mt-4 flex-wrap items-center gap-2">
        <AttentionChip n={attention.unreviewed} label={t("to review")} tone="accent" on={prefs.filter === "unreviewed"} onClick={() => setTrackingPref({ filter: prefs.filter === "unreviewed" ? "all" : "unreviewed" })} />
        <AttentionChip n={attention.missed} label={t("missed")} tone="miss" on={prefs.filter === "missed"} onClick={() => setTrackingPref({ filter: prefs.filter === "missed" ? "all" : "missed" })} />
        <AttentionChip n={attention.offPlan} label={t("off plan")} tone="warn" on={prefs.filter === "offplan"} onClick={() => setTrackingPref({ filter: prefs.filter === "offplan" ? "all" : "offplan" })} />
        <AttentionChip n={attention.prs} label={t("PRs")} tone="pr" on={prefs.filter === "prs"} onClick={() => setTrackingPref({ filter: prefs.filter === "prs" ? "all" : "prs" })} />
        <AttentionChip
          n={attention.lowReadiness}
          label={t("low readiness")}
          tone="warn"
          on={false}
          onClick={() => {
            const low = sessions.find((s) => s.readiness.score !== null && s.readiness.score <= LOW_READINESS);
            if (low) focusSession(low.day.id);
          }}
        />
        {current && (
          <span className="ml-auto text-[11px] text-muted-2">
            {t("{done}/{of} sets done", { done: current.setsDone, of: current.setsPrescribed })}
            {current.rpeDelta !== null && ` · ${t("RPE ran {delta} vs prescribed", { delta: `${current.rpeDelta > 0 ? "+" : ""}${current.rpeDelta}` })}`}
            {current.tonnage > 0 && ` · ${current.tonnage.toLocaleString()} ${unit}`}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-y border-border/60 py-2">
        <Seg value={prefs.filter} options={REVIEW_FILTERS.map((f) => ({ value: f, label: t(FILTER_LABEL[f]) }))} onChange={(f) => setTrackingPref({ filter: f })} label={t("Filter")} />
        <select
          value={prefs.lifts}
          aria-label={t("Exercises")}
          onChange={(e) => setTrackingPref({ lifts: e.target.value as LiftFilter })}
          className="cursor-pointer rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-muted outline-none hover:text-foreground"
        >
          {LIFT_FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(LIFT_LABEL[f])}
            </option>
          ))}
        </select>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          <Toggle on={prefs.expandAll} onChange={(v) => setTrackingPref({ expandAll: v })} label={t("Every set")} />
          <Toggle on={prefs.showCues} onChange={(v) => setTrackingPref({ showCues: v })} label={t("Coach notes")} />
          <Toggle on={prefs.showUpcoming} onChange={(v) => setTrackingPref({ showUpcoming: v })} label={t("Still to come")} />
        </span>
      </div>

      <div className="mt-3 space-y-3">
        {shown.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-muted-2">
            {sessions.length === 0 ? t("No sessions in this week.") : t("Nothing here with these filters.")}
            {prefs.filter !== "all" && (
              <button type="button" onClick={() => setTrackingPref({ filter: "all" })} className="ml-2 text-accent hover:underline">
                {t("Show every session")}
              </button>
            )}
          </div>
        )}
        {shown.map((s) => (
          <SessionCard
            key={s.day.id}
            session={s}
            unit={unit}
            athleteUnit={athlete.unit}
            focused={focusedSession?.day.id === s.day.id}
            open={!collapsed.has(s.day.id)}
            onToggle={() => toggleCollapsed(s.day.id)}
            onFocus={() => setFocused(s.day.id)}
            questions={questions}
            videos={videos}
            openRows={openRows}
            expandAll={prefs.expandAll}
            showCues={prefs.showCues}
            onToggleRow={toggleRow}
            onReviewed={(on) => setReviewed([s.day.id], on)}
            onSend={sendFor(s)}
            onEdit={async (id, body) => {
              const m = await editMessage(id, body);
              setMessages((list) => list.map((x) => (x.id === id ? m : x)));
            }}
            onDelete={(id) => {
              setMessages((list) => list.filter((x) => x.id !== id));
              startTransition(() => deleteMessage(id));
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex items-center rounded-full border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-2.5 py-0.5 text-[11px] ${o.value === value ? "bg-surface-3 text-foreground" : "text-muted-2 hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-1.5 text-[11px] text-muted hover:text-foreground">
      <span className={`relative inline-block h-3.5 w-6 rounded-full transition-colors ${on ? "bg-accent" : "bg-surface-3"}`}>
        <span className={`absolute top-0.5 size-2.5 rounded-full bg-white transition-all ${on ? "left-3" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

const TONE: Record<"accent" | "miss" | "warn" | "pr", string> = {
  accent: "bg-accent-soft text-accent",
  miss: "bg-miss/15 text-miss",
  warn: "bg-warn/15 text-warn",
  pr: "bg-pr/15 text-pr",
};

function AttentionChip({ n, label, tone, on, onClick }: { n: number; label: string; tone: keyof typeof TONE; on: boolean; onClick: () => void }) {
  if (n === 0) return null;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${TONE[tone]} ${on ? "ring-1 ring-current" : "hover:opacity-80"}`}
    >
      {tone === "pr" && <Trophy size={10} />}
      <span className="tabular-nums">{n}</span> {label}
    </button>
  );
}

/** The phase's weeks as tiles: how much is done, and a dot per session in its state. */
function WeekTiles({
  weeks,
  stats,
  active,
  onSelect,
}: {
  weeks: Session[][];
  stats: ReturnType<typeof weekStats>;
  active: number;
  onSelect: (week: number) => void;
}) {
  return (
    <div role="tablist" aria-label={t("Weeks")} className="flex gap-2 overflow-x-auto pb-1">
      {weeks.map((sessions, i) => {
        const stat = stats[i];
        const share = !stat || stat.setsPrescribed === 0 ? null : Math.round((stat.setsDone / stat.setsPrescribed) * 100);
        const on = i + 1 === active;
        const toReview = sessions.filter((s) => s.unreviewed).length;
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(i + 1)}
            className={`min-w-[112px] shrink-0 rounded-lg border px-3 py-2 text-left ${on ? "border-accent/60 bg-surface-2" : "border-border bg-surface hover:border-muted-2"}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-[12px] ${on ? "font-medium text-foreground" : "text-muted"}`}>{t("Week {n}", { n: i + 1 })}</span>
              <span className="text-[10px] tabular-nums text-muted-2">{share === null ? "—" : `${share}%`}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              {sessions.map((s) => (
                <span
                  key={s.day.id}
                  title={`${weekdayShort(s.weekday)} · ${s.day.label} · ${t(STATUS_LABEL[s.status])}`}
                  className="inline-block size-2 rounded-full"
                  style={{ background: STATUS_COLOR[s.status], border: STATUS_COLOR[s.status] === "transparent" ? "1px solid var(--muted-2)" : undefined }}
                />
              ))}
              {toReview > 0 && <span className="ml-auto rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">{toReview}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SessionCard({
  session: s,
  unit,
  athleteUnit,
  focused,
  open,
  onToggle,
  onFocus,
  questions,
  videos,
  openRows,
  expandAll,
  showCues,
  onToggleRow,
  onReviewed,
  onSend,
  onEdit,
  onDelete,
}: {
  session: Session;
  unit: string;
  athleteUnit: AthleteData["unit"];
  focused: boolean;
  open: boolean;
  onToggle: () => void;
  onFocus: () => void;
  questions: CheckinQuestionData[];
  videos: Record<string, VideoFile[]>;
  openRows: Set<string>;
  expandAll: boolean;
  showCues: boolean;
  onToggleRow: (rowId: string) => void;
  onReviewed: (on: boolean) => void;
  onSend: (body: string) => Promise<void>;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const reviewed = !s.unreviewed && !!s.day.reviewedAt;
  const done = s.lines.filter((l) => rowSets(l.row).done > 0).length;
  const low = s.readiness.score !== null && s.readiness.score <= LOW_READINESS;
  const yesNo = { yes: t("Yes"), no: t("No") };
  const answerText = s.answers
    .map((a) => {
      const q = questions.find((x) => x.id === a.questionId);
      return q ? `${q.label}: ${formatAnswer(q, a.value, yesNo)}` : null;
    })
    .filter(Boolean)
    .join(" · ");
  const notes = s.answers.filter((a) => questions.find((q) => q.id === a.questionId)?.kind === "TEXT" && a.value);

  return (
    <section
      id={`session-${s.day.id}`}
      onMouseDown={onFocus}
      className={`scroll-mt-4 overflow-hidden rounded-xl border bg-surface ${focused ? "border-accent/50" : "border-border"}`}
    >
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 bg-surface-2 px-4 py-2">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 items-center gap-2 text-left">
          <span
            className="inline-block size-2 shrink-0 rounded-full"
            title={t(STATUS_LABEL[s.status])}
            style={{ background: STATUS_COLOR[s.status], border: STATUS_COLOR[s.status] === "transparent" ? "1px solid var(--muted-2)" : undefined }}
          />
          <span className="truncate text-[13px] font-semibold">{s.day.label}</span>
          <span className="shrink-0 text-[11px] text-muted-2">
            {weekdayShort(s.weekday)} {formatDate(s.ymd)} · {t("{done}/{of} exercises", { done, of: s.lines.length })}
          </span>
        </button>
        {s.unreviewed && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">{t("to review")}</span>}
        {s.readiness.score !== null && (
          <span title={answerText} className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${low ? "bg-warn/15 text-warn" : "bg-surface-3 text-muted"}`}>
            {t("Readiness {n}/5", { n: s.readiness.score })}
            {low && s.readiness.low.length > 0 && ` · ${s.readiness.low.map((l) => `${l.label.toLowerCase()} ${l.value}`).join(", ")}`}
          </span>
        )}
        {notes.map((a) => (
          <span key={a.id} className="max-w-[260px] truncate text-[11px] italic text-muted" title={a.value ?? ""}>
            “{a.value}”
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1.5">
          {s.status !== "upcoming" && (
            <button
              type="button"
              onClick={() => onReviewed(!reviewed)}
              title={reviewed ? t("Reviewed — click to mark it not reviewed") : t("Mark reviewed")}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                reviewed ? "border-ok/40 text-ok" : "border-border text-muted hover:border-accent hover:text-accent"
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12l5 5L20 7" />
              </svg>
              {reviewed ? t("Reviewed") : t("Mark reviewed")}
            </button>
          )}
          <button type="button" onClick={onToggle} aria-label={open ? t("Collapse") : t("Expand")} className="grid size-6 place-items-center rounded text-muted hover:bg-surface-3">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={open ? "" : "-rotate-90"}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </span>
      </header>

      {open && (
        <>
          <div>
            {s.kept.map((line) => (
              <ExerciseLine
                key={line.row.id}
                line={line}
                unit={unit}
                athleteUnit={athleteUnit}
                videos={videos[line.row.id] ?? []}
                open={expandAll || openRows.has(line.row.id)}
                showCues={showCues}
                onToggle={() => onToggleRow(line.row.id)}
              />
            ))}
            {s.kept.length < s.lines.length && (
              <div className="border-t border-border/60 px-4 py-1.5 text-[11px] text-muted-2">
                {t("{n} more hidden by the filters", { n: s.lines.length - s.kept.length })}
              </div>
            )}
          </div>
          {s.status !== "upcoming" && <Feedback session={s} onSend={onSend} onEdit={onEdit} onDelete={onDelete} />}
        </>
      )}
    </section>
  );
}

/** "180 × 5 5 5 5 @8 8 8.5 9" when every set was the same weight, else each set in turn. */
function doneText(row: RowData, unit: string): string | null {
  const done = (row.logs ?? []).filter((l) => l.done);
  if (done.length === 0) {
    if (row.actualWeight === null) return null;
    return `${row.actualWeight} ${unit}${row.performedRpe !== null ? ` @${row.performedRpe}` : ""}`;
  }
  const weights = new Set(done.map((l) => l.weight));
  const efforts = done.map((l) => formatEffort(l)).filter(Boolean);
  if (weights.size === 1) {
    const reps = done.map((l) => l.reps ?? "—").join(" ");
    const sameEffort = new Set(efforts).size === 1;
    const effort = efforts.length === 0 ? "" : sameEffort ? ` ${efforts[0]}` : ` ${efforts.join(" ").replace(/ @/g, " ")}`;
    return `${done[0].weight ?? "—"} × ${reps}${effort}`;
  }
  return done.map((l) => `${l.weight ?? "—"}×${l.reps ?? "—"}${formatEffort(l) ? ` ${formatEffort(l)}` : ""}`).join(", ");
}

function ExerciseLine({
  line,
  unit,
  athleteUnit,
  videos,
  open,
  showCues,
  onToggle,
}: {
  line: Line;
  unit: string;
  athleteUnit: AthleteData["unit"];
  videos: VideoFile[];
  open: boolean;
  showCues: boolean;
  onToggle: () => void;
}) {
  const { row, target, off, pr, e1rm, previous } = line;
  const plan = `${row.sets ?? "—"}×${row.reps ?? "—"} @ ${formatPrescription(row, athleteUnit)}`;
  const done = doneText(row, unit);
  const delta = e1rm !== null && previous?.e1rm != null ? Math.round((e1rm - previous.e1rm) * 10) / 10 : null;
  const cues = [row.coachNotes, row.tempo && `${t("Tempo")} ${row.tempo}`, row.restTime && `${t("Rest")} ${row.restTime}`].filter(Boolean).join(" · ");
  const edge = pr ? "border-l-pr" : off?.level === "miss" ? "border-l-miss" : off ? "border-l-warn" : "border-l-transparent";

  return (
    <div className={`border-t border-l-[3px] border-t-border/60 ${edge}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full grid-cols-[minmax(140px,1.1fr)_minmax(200px,2fr)_minmax(110px,auto)_20px] items-center gap-3 px-4 py-2 pl-[13px] text-left hover:bg-surface-2/60"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[12px] font-medium">
            <span className="truncate">{row.exercise}</span>
            {pr && (
              <span title={t("The athlete flagged a PR")} className="flex shrink-0 items-center gap-0.5 rounded bg-pr/15 px-1 py-px text-[9px] font-bold tracking-wider text-pr">
                <Trophy size={9} /> {t("PR")}
              </span>
            )}
            {videos.length > 0 && (
              <span title={t("{n} videos", { n: videos.length })} className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-2">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 10l5-3v10l-5-3M3 7h12v10H3z" />
                </svg>
                {videos.length}
              </span>
            )}
          </span>
          {showCues && cues && <span className="block truncate text-[10px] text-muted-2">{cues}</span>}
        </span>
        <span className="min-w-0 truncate text-[12px] tabular-nums">
          <span className="text-muted-2">
            {plan}
            {target !== null && row.intensityType !== "WEIGHT" && ` · ${target} ${unit}`}
            {" → "}
          </span>
          {done ? <span className="text-foreground">{done}</span> : <span className={off?.level === "miss" ? "text-miss" : "text-muted-2"}>{off?.level === "miss" ? t("not done") : "—"}</span>}
        </span>
        <span className="flex items-center justify-end gap-2 text-[12px] tabular-nums">
          {off && off.level === "warn" && <OffChip off={off} row={row} target={target} />}
          {e1rm !== null && (
            <span className="whitespace-nowrap text-muted" title={t("Estimated 1RM from the top set")}>
              {t("e1RM")} <span className="text-foreground">{e1rm}</span>
              {delta !== null && delta !== 0 && <span className={`ml-1 text-[11px] ${delta > 0 ? "text-ok" : "text-muted-2"}`}>{delta > 0 ? `+${delta}` : delta}</span>}
            </span>
          )}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`text-muted-2 ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="grid gap-4 bg-surface-2/40 px-4 pb-3 pl-[29px] pt-1 md:grid-cols-2">
          <div className="min-w-0">
            {row.logs && row.logs.length > 0 ? (
              <table className="text-[11px] tabular-nums">
                <tbody>
                  {row.logs.map((l) => (
                    <tr key={l.setIndex}>
                      <td className="pr-4 text-muted-2">{t("Set {n}", { n: l.setIndex + 1 })}</td>
                      <td className={`pr-3 ${l.done ? "text-foreground" : "text-muted-2"}`}>{l.weight === null ? "—" : `${l.weight} ${unit}`}</td>
                      <td className={`pr-3 ${l.done ? "text-foreground" : "text-muted-2"}`}>{l.reps === null ? "—" : `× ${l.reps}`}</td>
                      <td className="pr-3 text-muted">{formatEffort(l) || "—"}</td>
                      <td className={l.done ? "pr-3 text-ok" : "pr-3 text-muted-2"}>{l.done ? "✓" : t("not done")}</td>
                      <td className="text-pr">{l.pr && <span className="flex items-center gap-0.5 font-semibold"><Trophy size={10} /> {t("PR")}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-[11px] text-muted-2">{row.actualWeight !== null ? done : t("No sets logged.")}</div>
            )}
            {previous && (
              <div className="mt-2 text-[11px] text-muted-2">
                {t("Last time ({date})", { date: formatDate(previous.ymd) })}: {previous.weight} {unit}
                {previous.reps !== null && ` × ${previous.reps}`}
                {previous.rpe !== null && ` @${previous.rpe}`}
                {previous.e1rm !== null && ` · ${t("e1RM")} ${previous.e1rm}`}
              </div>
            )}
            {cues && <div className="mt-1 text-[11px] text-muted-2">{cues}</div>}
          </div>
          <div className="min-w-0 space-y-2">
            {row.athleteNotes ? (
              <div className="text-[12px] italic text-muted">“{row.athleteNotes}”</div>
            ) : (
              <div className="text-[11px] text-muted-2">{t("No note from the athlete.")}</div>
            )}
            <RowVideos rowId={row.id} exercise={row.exercise} videos={videos} />
          </div>
        </div>
      )}
    </div>
  );
}

function OffChip({ off, row, target }: { off: OffPlan; row: RowData; target: number | null }) {
  const parts = off.reasons.map((reason) => {
    if (reason === "under" && target !== null && row.actualWeight !== null) {
      return t("{n}% under", { n: Math.round((1 - row.actualWeight / target) * 100) });
    }
    if (reason === "rpe") {
      const delta = rpeDelta(row);
      return delta === null ? "" : t("RPE +{n}", { n: Math.round(delta * 10) / 10 });
    }
    return "";
  });
  const text = parts.filter(Boolean).join(" · ");
  if (!text) return null;
  return <span className="whitespace-nowrap rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">{text}</span>;
}

/** The coach's notes on the session, and the box to write the next one. */
function Feedback({
  session: s,
  onSend,
  onEdit,
  onDelete,
}: {
  session: Session;
  onSend: (body: string) => Promise<void>;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const body = draft.trim();
    if (!body || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        if (editing) await onEdit(editing, body);
        else await onSend(body);
        setDraft("");
        setEditing(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="border-t border-border bg-surface px-4 py-2.5">
      {s.messages.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {s.messages.map((m) => (
            <li key={m.id} className="group flex items-start gap-2 text-[12px]">
              <span className="mt-0.5 shrink-0 rounded bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">{t("You")}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-foreground">{m.body}</span>
              <span className="shrink-0 text-[10px] text-muted-2" title={new Date(m.createdAt).toLocaleString()}>
                {m.readAt ? t("read") : t("not read yet")}
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditing(m.id);
                  setDraft(m.body);
                  requestAnimationFrame(() => (document.getElementById(`feedback-${s.day.id}`) as HTMLTextAreaElement | null)?.focus());
                }}
                className="shrink-0 text-[10px] text-muted-2 opacity-0 hover:text-accent group-hover:opacity-100"
              >
                {t("Edit")}
              </button>
              <button type="button" onClick={() => onDelete(m.id)} className="shrink-0 text-[10px] text-muted-2 opacity-0 hover:text-miss group-hover:opacity-100">
                {t("Delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea
          id={`feedback-${s.day.id}`}
          value={draft}
          rows={draft.includes("\n") ? 3 : 1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape" && editing) {
              setEditing(null);
              setDraft("");
            }
          }}
          placeholder={t("Feedback for the athlete — shows in their inbox")}
          className="min-h-8 flex-1 resize-y rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] outline-none placeholder:text-muted-2 focus:border-accent"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || pending}
          title={t("Ctrl+Enter")}
          className="h-8 shrink-0 rounded-lg bg-accent px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {editing ? t("Save") : t("Send and mark reviewed")}
        </button>
      </div>
      {error && <div className="mt-1 text-[11px] text-miss">{error}</div>}
    </div>
  );
}

