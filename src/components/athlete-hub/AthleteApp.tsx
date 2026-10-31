"use client";

import { useState } from "react";
import { AthleteLinkButton, AthleteLinkPanel } from "@/components/AthleteLink";
import { ShareButton } from "@/components/AthleteShares";
import { CheckinCard } from "@/components/athlete/CheckinCard";
import { Panel } from "@/components/athlete-hub/Panel";
import { CheckinQuestions } from "@/components/CheckinQuestions";
import type { RosterEntry } from "@/components/Roster";
import { asksOn } from "@/lib/checkins";
import { formatDate, weekdayOf, weekStartOf } from "@/lib/dates";
import { t, weekdayShort } from "@/lib/i18n";
import { addDays } from "@/lib/schedule";
import { activeSettings } from "@/lib/settings";
import { ROLE_LABEL } from "@/lib/roles";
import { canEdit } from "@/lib/share";

/** A link's state beside its button: whether one has been handed out. */
function LinkState({ sent }: { sent: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-muted-2">
      <span aria-hidden className={`size-1.5 rounded-full ${sent ? "bg-ok" : "bg-muted-2"}`} />
      {sent ? t("sent") : t("not sent yet")}
    </span>
  );
}

/**
 * The Athlete app tab: what the athlete's phone asks each morning, the link it opens, who
 * else can see them — and the check-in as it looks on the phone, day by day.
 */
export function AthleteApp({
  athlete,
  signedIn,
  today,
  linkOpen,
  shareOpen,
  phoneOpen = false,
}: {
  athlete: RosterEntry;
  signedIn: boolean;
  today: string;
  linkOpen: boolean;
  shareOpen: boolean;
  /** The phone link's popover opens straight away — the palette's "Open on your phone…". */
  phoneOpen?: boolean;
}) {
  const readOnly = !canEdit(athlete.share);
  const own = athlete.share.role === "own";
  const start = weekStartOf(today, activeSettings().weekStart);
  const week = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const [day, setDay] = useState(today);
  const asked = athlete.questions.filter((q) => asksOn(q, day));

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-4">
        <Panel title={t("Check-in questions")} hint={t("What the athlete app asks before training. Scales feed the readiness score.")}>
          <CheckinQuestions athleteId={athlete.id} questions={athlete.questions} />
        </Panel>

        <Panel
          title={t("Check-in link")}
          hint={t("They open it on their phone to see their training and log every set. You see it here.")}
          aside={<LinkState sent={athlete.hasLink} />}
        >
          <div data-tour="athlete-link" className={linkOpen ? "rounded-lg ring-1 ring-accent/60 ring-offset-4 ring-offset-surface" : ""}>
            <AthleteLinkPanel athleteId={athlete.id} />
          </div>
        </Panel>

        <Panel title={t("On your phone")} hint={t("Review, write and chat from your phone: sign in there with your Topset account.")}>
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <span className="min-w-0 flex-1 basis-[220px] text-[12px] text-muted">
              {signedIn ? t("Scan the code to open {name} on your phone.", { name: athlete.name }) : t("Sign in under Settings first: your phone signs in to the same account.")}
            </span>
            {signedIn && <AthleteLinkButton kind="phone" athleteId={athlete.id} name={athlete.name} hasLink initiallyOpen={phoneOpen} />}
          </div>
        </Panel>

        {own && (
          <Panel title={t("Who else can see them")}>
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <span className="min-w-0 flex-1 basis-[220px]">
                <span className="block font-medium">{t("Coaches")}</span>
                <span className="block text-[12px] text-muted">
                  {athlete.sharedWith.length === 0
                    ? t("Not shared with another coach.")
                    : athlete.sharedWith.map((s) => `${s.name} · ${t(ROLE_LABEL[s.role as keyof typeof ROLE_LABEL] ?? s.role)}`).join(", ")}
                </span>
              </span>
              {signedIn ? (
                <ShareButton athleteId={athlete.id} name={athlete.name} sharedWith={athlete.sharedWith} initiallyOpen={shareOpen} />
              ) : (
                <span className="text-[12px] text-muted-2">{t("Sign in under Settings to share.")}</span>
              )}
            </div>
          </Panel>
        )}
      </fieldset>

      <section aria-label={t("Preview")} className="flex flex-col items-center gap-3">
        <div className="text-[12px] text-muted">{t("What {name} sees", { name: athlete.name })}</div>
        <div role="group" aria-label={t("Day")} className="flex gap-1">
          {week.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === day}
              onClick={() => setDay(d)}
              className={`h-7 w-9 rounded-md text-[11px] ${d === day ? "bg-accent-soft font-medium text-accent" : "border border-border text-muted-2 hover:text-foreground"}`}
            >
              {weekdayShort(weekdayOf(d)).slice(0, 2)}
            </button>
          ))}
        </div>
        <div className="w-full max-w-[340px] rounded-[40px] border border-border bg-surface-2 p-2.5">
          <div className="h-[640px] overflow-y-auto rounded-[32px] bg-background px-4 pb-6 pt-7">
            <div className="text-[12px] text-muted">
              {weekdayShort(weekdayOf(day))} {formatDate(day)}
            </div>
            <div className="truncate text-[19px] font-semibold">{athlete.name}</div>
            {asked.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted">{t("No check-in this day.")}</p>
            ) : (
              <CheckinCard
                key={day}
                preview
                token=""
                unit={athlete.unit}
                day={day}
                today={day}
                initial={{ questions: asked, answers: [], photos: [], photosOn: false, target: null }}
                bodyweight={[]}
              />
            )}
          </div>
        </div>
        <p className="text-center text-[11px] text-muted-2">{t("A preview: nothing answered here is saved.")}</p>
      </section>
    </div>
  );
}
