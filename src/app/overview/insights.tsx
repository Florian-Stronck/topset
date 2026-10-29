import type { OverviewData } from "@/app/overview/data";
import { InsightsBoard, type Kpi, type Note } from "@/components/overview/InsightsBoard";
import { daySets, rpeDrift } from "@/lib/compliance";
import { t } from "@/lib/i18n";
import { LIFT_LABEL, type LiftKey } from "@/lib/progress";
import { suggestionsFor } from "@/lib/roster";
import { addDays } from "@/lib/schedule";

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Insights: how the roster did this week against the weeks before, what the trends say is
 * worth doing (each with its reason and a button), whose maxes are moving, and what the
 * athletes wrote in their check-ins.
 */
export function InsightsPane({ data, names }: { data: OverviewData; names: Map<string, string> }) {
  const { today, trend, rows, sessions, checkins } = data;
  const inWeek = (ymd: string, w: string) => ymd >= w && ymd < addDays(w, 7) && ymd <= today;
  const all = [...sessions.values()].flat();

  const done = trend.map((w) => {
    const due = all.filter((s) => inWeek(s.ymd, w) && (s.ymd < today || daySets(s.rows).done > 0)).map((s) => daySets(s.rows));
    const of = due.reduce((n, d) => n + d.prescribed, 0);
    return of === 0 ? null : Math.round((due.reduce((n, d) => n + d.done, 0) / of) * 100);
  });
  const drift = trend.map((w) => rpeDrift(all.filter((s) => inWeek(s.ymd, w)).flatMap((s) => s.rows)).mean);
  const readiness = trend.map((_, i) => {
    const v = rows.map((r) => r.readiness[i]).filter((x): x is number => x !== null);
    return v.length === 0 ? null : round1(v.reduce((a, b) => a + b, 0) / v.length);
  });
  const logged = trend.map((w) => all.filter((s) => inWeek(s.ymd, w) && daySets(s.rows).done > 0).length);
  const prs = trend.map((w) => data.prs.filter((p) => inWeek(p.loggedAt.toISOString().slice(0, 10), w)).length);

  const kpi = (label: string, values: (number | null)[], show: (n: number) => string, good: "up" | "down" | "near0", unit = ""): Kpi => {
    const now = values.at(-1) ?? null;
    const before = values.at(-2) ?? null;
    const delta = now !== null && before !== null ? round1(now - before) : null;
    const better = delta === null || delta === 0 ? null : good === "up" ? delta > 0 : good === "down" ? delta < 0 : Math.abs(now!) < Math.abs(before!);
    return {
      label,
      value: now === null ? "—" : show(now),
      delta: delta === null ? t("nothing to compare yet") : delta === 0 ? t("same as last week") : t("{d}{u} vs last week", { d: signed(delta), u: unit }),
      tone: better === null ? "plain" : better ? "ok" : "warn",
      values,
    };
  };
  const kpis: Kpi[] = [
    kpi(t("SETS DONE"), done, (n) => `${n}%`, "up", ` ${t("pts")}`),
    kpi(t("RPE VS PLAN"), drift, signed, "near0"),
    kpi(t("READINESS"), readiness, (n) => n.toFixed(1), "up"),
    kpi(t("SESSIONS LOGGED"), logged, String, "up"),
    // PRs only reach back two weeks.
    kpi(t("PRS"), prs.map((n, i) => (i < prs.length - 2 ? null : n)), String, "up"),
  ];

  const lift = (l: LiftKey) => t(LIFT_LABEL[l]);
  const suggestions = rows
    .flatMap((row) =>
      suggestionsFor(row, {
        rundown: (from, to, d) => ({
          title: t("{name} looks run down — a lighter week?", { name: row.name }),
          why:
            t("Readiness went from {from} to {to} over the last weeks", { from: from.toFixed(1), to: to.toFixed(1) }) +
            (d !== null && d > 0 ? t(", while RPE ran {d} over the plan", { d: signed(d) }) : "") +
            ".",
        }),
        raise: (l, from, to) => ({
          title: t("Raise {name}'s {lift} max {from} → {to}", { name: row.name, lift: lift(l), from, to }),
          why: t("The best {lift} of the last four weeks works out to {to} {u}, {pct}% over the {from} the targets use.", {
            lift: lift(l),
            to,
            u: row.unit,
            from,
            pct: round1((to / from - 1) * 100),
          }),
        }),
        stall: (l, e1rm) => ({
          title: t("{name}'s {lift} has stalled", { name: row.name, lift: lift(l) }),
          why: t("Estimated max flat at {n} {u} over four weeks while the other lifts went up.", { n: e1rm, u: row.unit }),
        }),
        push: (d) => ({
          title: t("{name} has room to push", { name: row.name }),
          why: t("Logged RPE ran {d} under the plan two weeks running — the targets may be light.", { d: signed(d) }),
        }),
      }).map((s) => ({ ...s, athlete: row.name, href: s.max ? row.href : row.programHref, unit: row.unit, phaseId: row.phaseId, onPhase: s.max ? row.lifts[s.max.lift].onPhase : false })),
    )
    .sort((a, b) => ["miss", "warn", "ok"].indexOf(a.tone) - ["miss", "warn", "ok"].indexOf(b.tone));

  const strength = Object.fromEntries(
    (["squat", "bench", "dead"] as const).map((l) => [
      l,
      rows
        .filter((r) => r.lifts[l].change !== null)
        .map((r) => ({ name: r.name, change: r.lifts[l].change! }))
        .sort((a, b) => b.change - a.change),
    ]),
  ) as Record<LiftKey, { name: string; change: number }[]>;

  const notes: Note[] = [];
  for (const [id, c] of checkins) {
    const text = new Set(c.questions.filter((q) => q.kind === "TEXT").map((q) => q.id));
    for (const a of c.answers) {
      if (text.has(a.questionId) && a.value && a.day >= addDays(today, -6)) notes.push({ athlete: names.get(id) ?? "", day: a.day, text: a.value });
    }
  }
  notes.sort((a, b) => b.day.localeCompare(a.day));

  return <InsightsBoard kpis={kpis} suggestions={suggestions} strength={strength} notes={notes.slice(0, 8)} today={today} />;
}
