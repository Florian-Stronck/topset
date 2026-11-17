"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteCompetition, updateCompetition } from "@/app/competition/list-actions";
import type { CompetitionDetailData, Entry } from "@/app/competition/detail-data";
import { AddAthletesDialog } from "@/components/competition/AddAthletesDialog";
import { formKeys } from "@/components/cells";
import { competitionHref, daysUntil, MEET_LIFTS, openersSet } from "@/lib/competition";
import { useCommands, type Command } from "@/lib/commands";
import { formatDate, weekdayOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";
import { SHELL_MAX_WIDTH } from "@/lib/layout";

const FIELD = "w-full rounded border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent/60";
const day = (ymd: string) => `${weekdayShort(weekdayOf(ymd))} ${formatDate(ymd, true)}`;

/** One competition: what it is, who is entered, and where each athlete stands. The page puts the sidebar beside it. */
export function CompetitionDetail(props: CompetitionDetailData) {
  const { competition: c, entries, candidates, classes, today } = props;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const ymd = c.date.slice(0, 10);
  const days = daysUntil(c.date, new Date(today));
  const sub = [day(ymd), c.venue, c.federation, days >= 0 ? t("{n} days out", { n: days }) : t("{n} days ago", { n: -days })].filter(Boolean);

  const commands = useMemo<Command[]>(
    () => [
      { id: "competition-back", group: "Competition", title: t("Back to competitions"), kind: "place", run: () => router.push("/competition") },
      { id: "competition-edit", group: "Competition", title: t("Edit competition details"), run: () => setEditing(true) },
      { id: "competition-add-athletes", group: "Competition", title: t("Add athletes to the competition…"), run: () => setAdding(true) },
      { id: "competition-delete", group: "Competition", title: t("Delete competition"), run: () => setDeleting(true) },
      ...entries.map(
        (e): Command => ({
          id: `competition-entry-${e.meetId}`,
          group: "Competition",
          title: t("Open {name}'s attempts", { name: e.athlete.name }),
          kind: "place",
          run: () => router.push(competitionHref(e.athlete.id, e.meetId)),
        }),
      ),
    ],
    [entries, router],
  );
  useCommands("competition-detail", commands);

  const facts: [string, string][] = [
    [t("Weigh-in"), [c.weighInDay && day(c.weighInDay), c.weighInTime].filter(Boolean).join(" ") || "—"],
    [t("Lifting starts"), c.startTime ?? "—"],
    [t("Rack brand"), c.rackBrand ?? "—"],
    [t("Reminders"), t("{n} on", { n: c.remindersOn })],
  ];

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div style={{ maxWidth: SHELL_MAX_WIDTH }} className="mx-auto w-full px-6 py-7">
        <Link href="/competition" className="text-[12px] text-muted hover:text-accent">
          {t("← Competitions")}
        </Link>

        <header className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <h1 className="text-[22px] font-semibold">{c.name}</h1>
            <p className="mt-1 text-[12px] text-muted">{sub.join(" · ")}</p>
          </div>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:border-muted-2 hover:text-foreground"
          >
            {t("Edit details")}
          </button>
          <button type="button" onClick={() => setAdding(true)} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
            {t("+ Add athletes")}
          </button>
        </header>

        {editing && (
          <EditForm
            c={c}
            onDone={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        )}

        <dl className="mt-5 grid gap-2 sm:grid-cols-4">
          {facts.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-surface px-3 py-2.5">
              <dt className="text-[11px] tracking-[0.14em] text-muted-2">{label.toUpperCase()}</dt>
              <dd className="mt-1 text-[14px] font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-6 text-[13px] font-semibold">{t("Entered athletes · {n}", { n: entries.length })}</h2>
        {entries.length === 0 ? (
          <div className="mt-2 rounded-xl border border-dashed border-border px-6 py-10 text-center text-[13px] text-muted">{t("Nobody is entered yet.")}</div>
        ) : (
          <Roster entries={entries} />
        )}

        <div className="flex justify-end pb-10 pt-6">
          {deleting ? (
            <div className="flex items-center gap-2 rounded-full border border-accent/50 bg-surface px-3 py-1.5">
              <span className="text-[11px] text-muted">{t("Delete “{name}” and its attempts?", { name: c.name })}</span>
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await deleteCompetition(c.id);
                    router.push("/competition");
                  })
                }
                className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-white"
              >
                {t("Delete")}
              </button>
              <button type="button" onClick={() => setDeleting(false)} className="text-[11px] text-muted-2 hover:text-foreground">
                {t("Cancel")}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setDeleting(true)} className="text-[11px] text-muted-2 hover:text-accent">
              {t("Delete competition")}
            </button>
          )}
        </div>
      </div>
      {adding && (
        <AddAthletesDialog
          competition={c}
          candidates={candidates}
          classes={classes}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      )}
    </main>
  );
}

function Roster({ entries }: { entries: Entry[] }) {
  const th = "px-3 py-2 text-left text-[11px] font-normal tracking-[0.14em] text-muted-2";
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-border">
            <th className={th}>{t("ATHLETE")}</th>
            <th className={th}>{t("CLASS")}</th>
            <th className={th}>{t("SESSION / FLIGHT")}</th>
            <th className={th}>{t("OPENERS S / B / D")}</th>
            <th className={th}>{t("GOAL TOTAL")}</th>
            <th className={th}>{t("BODY WT")}</th>
            <th className={th}>{t("CHECKLIST")}</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const set = openersSet(MEET_LIFTS.map((lift) => ({ lift, number: 1, weight: e.openers[lift] })));
            const unit = e.athlete.unit === "LB" ? "lb" : "kg";
            const href = competitionHref(e.athlete.id, e.meetId);
            return (
              <tr key={e.meetId} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <Link href={href} className="flex items-center gap-2 font-medium hover:text-accent">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
                      {e.athlete.name.slice(0, 1).toUpperCase()}
                    </span>
                    {e.athlete.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted">{e.weightClass ?? "—"}</td>
                <td className="px-3 py-2 text-muted">{e.session ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">
                  <span className="flex items-center gap-2">
                    <span
                      role="img"
                      aria-label={t("{n} of 3 openers set", { n: set })}
                      className={`size-2 shrink-0 rounded-full ${set === 3 ? "bg-ok" : set > 0 ? "bg-warn" : "bg-muted-2"}`}
                    />
                    {MEET_LIFTS.map((l) => e.openers[l] ?? "—").join(" / ")}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums text-muted">{e.goal !== null ? `${e.goal} ${unit}` : "—"}</td>
                <td className="px-3 py-2 tabular-nums text-muted">{e.bodyweight !== null ? `${e.bodyweight} ${unit}` : "—"}</td>
                <td className="px-3 py-2 tabular-nums text-muted">{e.tasksTotal > 0 ? `${e.tasksDone}/${e.tasksTotal}` : "—"}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={href} className="text-accent hover:underline" aria-label={t("Open {name}'s attempts", { name: e.athlete.name })}>
                    {t("Attempts →")}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EditForm({ c, onDone, onCancel }: { c: CompetitionDetailData["competition"]; onDone: () => void; onCancel: () => void }) {
  const [pending, setPending] = useState(false);
  const [f, setF] = useState({
    name: c.name,
    date: c.date.slice(0, 10),
    venue: c.venue ?? "",
    federation: c.federation ?? "",
    weighInDay: c.weighInDay ?? "",
    weighInTime: c.weighInTime ?? "",
    startTime: c.startTime ?? "",
    rackBrand: c.rackBrand ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!f.name.trim() || !f.date) return;
    setPending(true);
    await updateCompetition(c.id, { ...f, name: f.name.trim() });
    setPending(false);
    onDone();
  }

  const label = (text: string, input: React.ReactNode) => (
    <label className="block text-[11px] text-muted-2">
      {text}
      <span className="mt-0.5 block">{input}</span>
    </label>
  );

  return (
    <div onKeyDown={formKeys(save, onCancel, pending)} className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {label(t("Name"), <input autoFocus value={f.name} onChange={set("name")} className={FIELD} />)}
        {label(t("Date"), <input type="date" value={f.date} onChange={set("date")} className={FIELD} />)}
        {label(t("Venue"), <input value={f.venue} onChange={set("venue")} className={FIELD} />)}
        {label(t("Federation"), <input value={f.federation} onChange={set("federation")} className={FIELD} />)}
        {label(t("Weigh-in day"), <input type="date" value={f.weighInDay} onChange={set("weighInDay")} className={FIELD} />)}
        {label(t("Weigh-in time"), <input type="time" value={f.weighInTime} onChange={set("weighInTime")} className={FIELD} />)}
        {label(t("Lifting starts"), <input type="time" value={f.startTime} onChange={set("startTime")} className={FIELD} />)}
        {label(t("Rack brand"), <input value={f.rackBrand} onChange={set("rackBrand")} className={FIELD} />)}
      </div>
      <div className="mt-2.5 flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:text-foreground">
          {t("Cancel")}
        </button>
        <button type="button" disabled={pending} onClick={save} className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60">
          {pending ? t("Saving…") : t("Save")}
        </button>
      </div>
    </div>
  );
}

export default CompetitionDetail;
