"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { addEntries } from "@/app/competition/list-actions";
import type { Candidate, CompetitionDetailData } from "@/app/competition/detail-data";
import { useCommands, type Command } from "@/lib/commands";
import { formatDate, weekdayOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";

const HINT: Record<NonNullable<Candidate["hint"]>["kind"], string> = {
  injury: "Injury: {name}",
  meet: "Also entered in {name}",
  block: "Training: {name}",
  last: "Last meet: {name}",
};

/** Pick athletes to enter in a competition, each with a weight class, and whether it shows on their phones. */
export function AddAthletesDialog({
  competition,
  candidates,
  classes,
  onClose,
  onAdded,
}: {
  competition: CompetitionDetailData["competition"];
  candidates: Candidate[];
  classes: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const list = useId();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [shared, setShared] = useState(competition.shared);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commands = useMemo<Command[]>(
    () => [{ id: "competition-add-shared", group: "Competition", title: t("Add athletes: show on their phones on / off"), run: () => setShared((s) => !s) }],
    [],
  );
  useCommands("competition-add", commands);

  const shown = candidates.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
  const ids = Object.keys(picked);

  function toggle(c: Candidate) {
    setPicked((p) => {
      const { [c.id]: was, ...rest } = p;
      return was === undefined ? { ...p, [c.id]: c.weightClass ?? "" } : rest;
    });
  }

  async function add() {
    if (ids.length === 0 || pending) return;
    setPending(true);
    await addEntries(
      competition.id,
      ids.map((athleteId) => ({ athleteId, weightClass: picked[athleteId].trim() || null })),
      shared,
    );
    onAdded();
  }

  const ymd = competition.date.slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-labelledby={`${list}-title`} className="flex max-h-[92vh] w-full max-w-[560px] flex-col rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <h2 id={`${list}-title`} className="text-[16px] font-semibold">
          {t("Add athletes to {name}", { name: competition.name })}
        </h2>
        <p className="mt-0.5 text-[12px] text-muted">
          {[`${weekdayShort(weekdayOf(ymd))} ${formatDate(ymd, true)}`, competition.federation].filter(Boolean).join(" · ")}
        </p>
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search athletes")}
          aria-label={t("Search athletes")}
          className="mt-3 h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none placeholder:text-muted-2 focus:border-accent"
        />
        <datalist id={list}>
          {classes.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <ul className="mt-2 min-h-0 flex-1 overflow-auto">
          {shown.map((c) => {
            const locked = c.entered || !c.editable;
            const on = c.id in picked;
            return (
              <li key={c.id} className={`flex items-center gap-3 border-b border-border py-2 last:border-0 ${locked ? "opacity-50" : ""}`}>
                <label className="flex min-w-0 flex-1 items-center gap-3">
                  <input type="checkbox" checked={on} disabled={locked} onChange={() => toggle(c)} className="size-4 accent-[var(--accent)]" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">{c.name}</span>
                    <span className="block truncate text-[11px] text-muted-2">
                      {c.entered ? t("Already entered") : !c.editable ? t("Shared with you to look at") : c.hint ? t(HINT[c.hint.kind], { name: c.hint.name }) : ""}
                    </span>
                  </span>
                </label>
                {!locked && (
                  <input
                    list={list}
                    value={picked[c.id] ?? c.weightClass ?? ""}
                    disabled={!on}
                    onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.value }))}
                    placeholder={t("Class")}
                    aria-label={t("Weight class for {name}", { name: c.name })}
                    className="h-8 w-24 rounded border border-border bg-background px-2 text-[12px] outline-none focus:border-accent disabled:opacity-50"
                  />
                )}
              </li>
            );
          })}
          {shown.length === 0 && <li className="py-6 text-center text-[12px] text-muted">{t("No athletes found.")}</li>}
        </ul>

        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <label className="flex flex-1 items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            {t("Show on their phones")}
          </label>
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-foreground">
            {t("Cancel")}
          </button>
          <button
            type="button"
            disabled={ids.length === 0 || pending}
            onClick={add}
            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
          >
            {t("Add {n} athletes", { n: ids.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
