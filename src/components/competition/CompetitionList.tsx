"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCompetition } from "@/app/competition/list-actions";
import type { CompetitionRow } from "@/app/competition/list-data";
import { formKeys } from "@/components/cells";
import { useCommands, type Command } from "@/lib/commands";
import { daysUntil } from "@/lib/competition";
import { formatDate, ymdOf } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { SHELL_MAX_WIDTH } from "@/lib/layout";

const VIEWS = ["upcoming", "past", "all"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { upcoming: "Upcoming", past: "Past", all: "All" };
const VIEW_COMMAND: Record<View, string> = {
  upcoming: "Competitions: upcoming",
  past: "Competitions: past",
  all: "Competitions: all",
};

const MAX_FACES = 5;
const FIELD = "mt-1 block w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-accent";

/** "25 days" up to 8 weeks out, then weeks; nothing once it has been. */
function outLabel(days: number) {
  if (days < 0) return "—";
  if (days === 0) return t("today");
  return days < 56 ? t("{n} days", { n: days }) : t("{n} wk", { n: Math.round(days / 7) });
}

export function CompetitionList({ rows, view: viewParam, today }: { rows: CompetitionRow[]; view?: string; today: string }) {
  const router = useRouter();
  const view: View = VIEWS.includes(viewParam as View) ? (viewParam as View) : "upcoming";
  const now = useMemo(() => new Date(today), [today]);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [federation, setFederation] = useState("");
  const [pending, start] = useTransition();

  const isPast = (r: CompetitionRow) => daysUntil(r.date, now) < 0;
  const counts = { upcoming: rows.filter((r) => !isPast(r)).length, past: rows.filter(isPast).length, all: rows.length };
  const q = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => (view === "all" ? true : view === "past" ? isPast(r) : !isPast(r)))
    .filter((r) => !q || [r.name, r.venue, r.federation].some((v) => v?.toLowerCase().includes(q)));
  if (view === "past") shown.reverse();

  const setView = (v: View) => router.replace(v === "upcoming" ? "/competition" : `/competition?view=${v}`);
  const openAdd = () => {
    setDate((d) => d || ymdOf(now));
    setAdding(true);
  };
  const create = () => {
    if (!name.trim() || !date) return;
    start(async () => {
      const id = await createCompetition({ name: name.trim(), date, federation: federation.trim() || undefined });
      router.push(`/competition?comp=${id}`);
    });
  };
  const keys = formKeys(create, () => setAdding(false), pending);

  const commands: Command[] = [
    { id: "competitions-new", group: "Competition", title: t("New competition…"), keywords: "add create meet", run: openAdd },
    ...VIEWS.map((v): Command => ({
      id: `competitions-view-${v}`,
      group: "Competition",
      title: t(VIEW_COMMAND[v]),
      kind: "place",
      run: () => setView(v),
    })),
    ...rows.map((r): Command => ({
      id: `open-competition-${r.id}`,
      group: "Competition",
      title: t("Open competition {name}", { name: r.name }),
      keywords: [r.venue, r.federation].filter(Boolean).join(" "),
      kind: "place",
      run: () => router.push(`/competition?comp=${r.id}`),
    })),
  ];
  useCommands("competitions", commands);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div style={{ maxWidth: SHELL_MAX_WIDTH }} className="mx-auto w-full px-6 py-7">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-bold tracking-tight">{t("Competitions")}</h1>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search competitions")}
            aria-label={t("Search competitions")}
            className="ml-auto w-64 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <button type="button" onClick={openAdd} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
            + {t("New competition")}
          </button>
        </div>

        {adding && (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
            <label className="min-w-48 flex-1 text-[11px] text-muted-2">
              {t("Name")}
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={keys} className={FIELD} />
            </label>
            <label className="text-[11px] text-muted-2">
              {t("Date")}
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} onKeyDown={keys} className={FIELD} />
            </label>
            <label className="min-w-36 text-[11px] text-muted-2">
              {t("Federation")}
              <input value={federation} onChange={(e) => setFederation(e.target.value)} onKeyDown={keys} className={FIELD} />
            </label>
            <button
              type="button"
              onClick={create}
              disabled={pending || !name.trim() || !date}
              className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {t("Create")}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg px-3 py-1.5 text-[12px] text-muted hover:bg-surface-2">
              {t("Cancel")}
            </button>
          </div>
        )}

        <div className="mt-5 flex gap-1 border-b border-border text-[13px]">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`-mb-px border-b-2 px-3 py-2 ${v === view ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            >
              {t(VIEW_LABEL[v])}
              {v !== "all" && <span className="ml-1.5 text-muted-2">· {counts[v]}</span>}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="mt-16 text-center text-[13px] text-muted">
            <p>{rows.length === 0 ? t("No competitions yet.") : t("No competitions match.")}</p>
            {rows.length === 0 && (
              <button type="button" onClick={openAdd} className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
                + {t("New competition")}
              </button>
            )}
          </div>
        ) : (
          <table className="mt-2 w-full text-left text-[13px]">
            <thead>
              <tr className="text-[11px] tracking-[0.12em] text-muted-2">
                <th className="py-2 pr-3 font-medium">{t("Competition").toUpperCase()}</th>
                <th className="px-3 font-medium">{t("Date").toUpperCase()}</th>
                <th className="px-3 font-medium">{t("Federation").toUpperCase()}</th>
                <th className="px-3 font-medium">{t("Athletes").toUpperCase()}</th>
                <th className="px-3 font-medium">{t("Attempts ready").toUpperCase()}</th>
                <th className="pl-3 text-right font-medium">{t("Out").toUpperCase()}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const tone = r.ready === 0 ? "bg-muted-2" : r.ready === r.entered ? "bg-ok" : "bg-warn";
                return (
                  <tr key={r.id} onClick={() => router.push(`/competition?comp=${r.id}`)} className="cursor-pointer border-t border-border hover:bg-surface-2">
                    <td className="py-3 pr-3">
                      <div className="font-semibold">{r.name}</div>
                      {r.venue && <div className="text-[11px] text-muted-2">{r.venue}</div>}
                    </td>
                    <td className="px-3 text-muted">{formatDate(r.date, true)}</td>
                    <td className="px-3 text-muted">{r.federation ?? "—"}</td>
                    <td className="px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-1.5">
                          {r.athletes.slice(0, MAX_FACES).map((a) => (
                            <span key={a.id} title={a.name} className="grid size-5 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent ring-2 ring-background">
                              {a.name.slice(0, 1).toUpperCase()}
                            </span>
                          ))}
                          {r.athletes.length > MAX_FACES && (
                            <span className="grid size-5 place-items-center rounded-full bg-surface-2 text-[9px] font-semibold text-muted ring-2 ring-background">
                              +{r.athletes.length - MAX_FACES}
                            </span>
                          )}
                        </div>
                        <span className="text-muted">{r.entered === 1 ? t("1 athlete") : t("{n} athletes", { n: r.entered })}</span>
                      </div>
                    </td>
                    <td className="px-3">
                      {r.entered === 0 ? (
                        <span className="text-muted-2">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className={`size-1.5 rounded-full ${tone}`} />
                          {t("{n} of {total}", { n: r.ready, total: r.entered })}
                        </span>
                      )}
                    </td>
                    <td className="pl-3 text-right text-muted">{outLabel(daysUntil(r.date, now))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
