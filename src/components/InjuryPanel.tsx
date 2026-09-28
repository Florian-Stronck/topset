"use client";

import { useState, useTransition } from "react";
import { BodyMap } from "@/components/BodyMap";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { areaOf, areasIn, injuryLabel, isActive, sortInjuries, type AreaId, type InjuryData, type InjuryInput, type Side } from "@/lib/injuries";
import { daysBetween } from "@/lib/schedule";

const SEVERITY = ["", "Niggle", "Sore", "Limits training", "Can barely train it", "Can't train it"];

type Draft = InjuryInput;

/**
 * Injuries on a body map, current ones first and the history under them, with a form to
 * report one or change it. The same panel on the phone (the athlete's own) and in
 * Tracking (the coach's view of them); `save` and `remove` are whichever side's actions.
 */
export function InjuryPanel({
  initial,
  today,
  save,
  remove,
  phone = false,
}: {
  initial: InjuryData[];
  today: string;
  /** Left out where the panel only shows: the viewer link. */
  save?: (input: InjuryInput) => Promise<InjuryData>;
  remove?: (id: string) => Promise<void>;
  /** Big touch targets, and a heading that asks. */
  phone?: boolean;
}) {
  const readOnly = !save || !remove;
  const [list, setList] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sorted = sortInjuries(list, today);
  const active = sorted.filter((i) => isActive(i, today));
  const past = sorted.filter((i) => !isActive(i, today));

  function pick(area: AreaId, side: Side | null) {
    if (readOnly) return;
    // Tapping a sore spot opens that injury; anywhere else starts a new one there.
    const region = areaOf(area)?.region;
    const open = active.find((i) => areaOf(i.area)?.region === region && (i.side === side || i.side === null));
    setError(null);
    setDraft(open ? { ...open } : { area, side, day: today, endDay: null, severity: 2, note: null });
  }

  function commit(next: Draft) {
    setError(null);
    startTransition(async () => {
      try {
        const saved = await save!(next);
        setList((was) => [...was.filter((i) => i.id !== saved.id), saved]);
        setDraft(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function drop(id: string) {
    setList((was) => was.filter((i) => i.id !== id));
    setDraft(null);
    startTransition(() => remove!(id));
  }

  const sided = draft ? areaOf(draft.area)?.sided : false;
  // An elbow or a forearm, a calf or an Achilles: the areas sharing the tapped region.
  const siblings = draft ? areasIn(areaOf(draft.area)?.region ?? "") : [];
  const btn = phone ? "h-11 rounded-xl px-4 text-[14px]" : "rounded-lg px-2.5 py-1.5 text-[12px]";

  return (
    <section className={`rounded-xl border border-border bg-surface ${phone ? "rounded-2xl p-4" : "px-4 py-3"}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className={phone ? "text-[11px] tracking-[0.16em] text-muted" : "text-[11px] tracking-[0.16em] text-muted-2"}>
          {phone ? t("ANYTHING HURTING?") : t("INJURIES")}
        </h2>
        <span className="text-[11px] text-muted-2">
          {active.length === 0 ? t("nothing now") : t("{n} now", { n: active.length })}
        </span>
      </div>

      <div className={phone ? "mt-2" : "mt-2 grid items-start gap-4 md:grid-cols-[380px_1fr]"}>
        <BodyMap marks={active} picked={draft} onPick={readOnly ? undefined : pick} height={phone ? 300 : 340} />

        <div className="min-w-0">
          {!readOnly && !draft && (
            <p className={`text-muted-2 ${phone ? "mt-1 text-center text-[13px]" : "text-[11px]"}`}>
              {t("Tap where it hurts to report it, or a red spot to update it.")}
            </p>
          )}

          {draft && (
            <div className={`rounded-xl border border-accent/40 bg-surface-2 p-3 ${phone ? "mt-3" : ""}`}>
              <div className="text-[14px] font-semibold">{injuryLabel(draft)}</div>
              {siblings.length > 1 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {siblings.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={draft.area === a.id}
                      onClick={() => setDraft({ ...draft, area: a.id, side: a.sided ? (draft.side ?? "R") : null })}
                      className={`${btn} border ${draft.area === a.id ? "border-accent bg-accent-soft text-foreground" : "border-border text-muted"}`}
                    >
                      {t(a.label)}
                    </button>
                  ))}
                </div>
              )}
              {sided && (
                <div className="mt-2 flex gap-1.5">
                  {(["L", "R"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={draft.side === s}
                      onClick={() => setDraft({ ...draft, side: s })}
                      className={`${btn} border ${draft.side === s ? "border-accent bg-accent-soft text-foreground" : "border-border text-muted"}`}
                    >
                      {s === "L" ? t("Left") : t("Right")}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 text-[11px] tracking-[0.14em] text-muted-2">{t("HOW BAD")}</div>
              <div className="mt-1 grid grid-cols-5 gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={draft.severity === n}
                    title={t(SEVERITY[n])}
                    onClick={() => setDraft({ ...draft, severity: n })}
                    className={`${phone ? "h-11 text-[15px]" : "py-1 text-[12px]"} rounded-lg border tabular-nums ${
                      draft.severity === n ? "border-miss bg-miss/15 text-foreground" : "border-border text-muted"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[11px] text-muted-2">{t(SEVERITY[draft.severity])}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                <label className="flex items-center gap-1.5">
                  {t("Since")}
                  <input
                    type="date"
                    value={draft.day}
                    max={today}
                    onChange={(e) => e.target.value && setDraft({ ...draft, day: e.target.value })}
                    className="rounded border border-border bg-surface px-1.5 py-1 text-[12px] outline-none focus:border-accent"
                  />
                </label>
              </div>
              <textarea
                rows={2}
                value={draft.note ?? ""}
                placeholder={t("What happened, what makes it worse…")}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                className={`mt-2 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 outline-none placeholder:text-muted-2 focus:border-accent ${phone ? "text-[16px]" : "text-[12px]"}`}
              />
              {error && <div className="mt-2 text-[12px] text-accent">{error}</div>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" disabled={pending} onClick={() => commit(draft)} className={`${btn} bg-accent font-medium text-white disabled:opacity-60`}>
                  {draft.id ? t("Save") : t("Report it")}
                </button>
                {draft.id && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => commit({ ...draft, endDay: today < draft.day ? draft.day : today })}
                    className={`${btn} border border-ok/60 text-ok`}
                  >
                    {t("Cleared up")}
                  </button>
                )}
                <button type="button" onClick={() => setDraft(null)} className={`${btn} border border-border text-muted`}>
                  {t("Cancel")}
                </button>
                {draft.id && (
                  <button type="button" onClick={() => drop(draft.id!)} className={`${btn} ml-auto text-muted-2 hover:text-accent`}>
                    {t("Delete")}
                  </button>
                )}
              </div>
            </div>
          )}

          {active.length > 0 && (
            <ul className={`space-y-1.5 ${draft || phone ? "mt-3" : ""}`}>
              {active.map((i) => (
                <InjuryLine key={i.id} injury={i} today={today} onOpen={readOnly ? undefined : () => setDraft({ ...i })} phone={phone} />
              ))}
            </ul>
          )}

          {past.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowPast((s) => !s)} className="text-[11px] text-muted-2 hover:text-foreground">
                {showPast ? t("Hide the history") : t("History · {n} cleared up", { n: past.length })}
              </button>
              {showPast && (
                <ul className="mt-1.5 space-y-1.5">
                  {past.map((i) => (
                    <InjuryLine key={i.id} injury={i} today={today} onOpen={readOnly ? undefined : () => setDraft({ ...i })} phone={phone} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function InjuryLine({ injury, today, onOpen, phone }: { injury: InjuryData; today: string; onOpen?: () => void; phone: boolean }) {
  const on = isActive(injury, today);
  const days = daysBetween(injury.day, injury.endDay ?? today);
  const body = (
    <>
      <span className={`grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums ${on ? "bg-miss/20 text-miss" : "bg-surface-3 text-muted-2"}`}>
        {injury.severity}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${phone ? "text-[14px]" : "text-[12px]"} ${on ? "font-medium" : "text-muted"}`}>
          {injuryLabel(injury)}
          {injury.area === "head" && on && <span className="ml-1.5 text-[10px] font-semibold tracking-wider text-miss">{t("HEAD")}</span>}
        </span>
        <span className="block truncate text-[11px] text-muted-2">
          {on
            ? t("since {date} · {n} days", { date: formatDate(injury.day), n: days })
            : t("{from} – {to} · {n} days", { from: formatDate(injury.day), to: formatDate(injury.endDay!), n: days })}
          {injury.source === "coach" && ` · ${t("noted by the coach")}`}
          {injury.note && ` · ${injury.note}`}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left hover:bg-surface-2">
          {body}
        </button>
      ) : (
        <div className="flex items-center gap-2.5 px-1.5 py-1">{body}</div>
      )}
    </li>
  );
}
