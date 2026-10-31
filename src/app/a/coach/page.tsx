import Link from "next/link";
import { signOut } from "@/app/a/coach/actions";
import { Heading, initials } from "@/app/a/coach/parts";
import { loadOverview } from "@/app/overview/data";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { LOCALE, t } from "@/lib/i18n";
import type { InboxItem, InboxKind } from "@/lib/inbox";
import { phoneCoach } from "@/lib/phone-coach";
import { chatSummary, getOverview } from "@/lib/queries";
import { activeSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Where each kind of thing waiting on the coach is dealt with on the phone. */
function phoneHref(item: InboxItem): string {
  const base = `/a/coach/${item.athleteId}`;
  const where: Record<InboxKind, string> = {
    session: `${base}/training${item.session ? `?week=${item.session.week}` : ""}`,
    pr: `${base}/training`,
    training: `${base}/training`,
    program: `${base}/training?view=plan`,
    message: `/a/coach/chats?athlete=${item.athleteId}`,
    meeting: `${base}/schedule`,
    move: `${base}/schedule`,
    wellness: `${base}/body?view=wellness`,
    weight: `${base}/body?view=wellness`,
    link: `${base}/profile`,
  };
  return where[item.kind];
}

const CHIP: Partial<Record<InboxKind, { label: string; className: string }>> = {
  session: { label: "Review", className: "bg-accent-soft text-accent" },
  message: { label: "Chat", className: "bg-surface-2 text-foreground" },
  meeting: { label: "Answer", className: "bg-warn/15 text-warn" },
  move: { label: "Moved", className: "bg-surface-2 text-foreground" },
  pr: { label: "PR", className: "bg-pr/15 text-pr" },
};

/**
 * The coach's morning on the phone: what needs them (sessions to review, messages, meeting
 * requests, flags), counts on top, and who trains today — the desktop Overview's inbox.
 */
export default async function PhoneHome() {
  const coach = await phoneCoach();
  if (!coach) return null;
  const now = new Date();
  const today = ymdOf(calendarToday());
  const { athletes, targetsByBlock, linked } = await getOverview(now, coach.id);
  const chats = await chatSummary(athletes.map((a) => a.id));
  const data = await loadOverview(now, { athletes, targetsByBlock, linked, chats, coachId: coach.id });

  const items = [...data.items].sort((a, b) => Number(b.urgent) - Number(a.urgent) || (b.at ?? "").localeCompare(a.at ?? ""));
  const toReview = data.items.filter((i) => i.kind === "session").length;
  const firstReview = items.find((i) => i.kind === "session");
  const unread = [...chats.values()].reduce((n, c) => n + c.unread, 0);
  const next = data.rows.filter((r) => r.meet && r.meet.days >= 0).sort((a, b) => a.meet!.days - b.meet!.days)[0];
  const trainingToday = athletes.flatMap((a) => {
    const s = (data.sessions.get(a.id) ?? []).find((x) => x.ymd === today);
    if (!s) return [];
    const rows = s.rows.filter((r) => r.exercise.trim() !== "");
    const logged = rows.filter((r) => r.logs.some((l) => l.done) || r.actualWeight !== null).length;
    return [{ athlete: a, label: s.label, logged, of: rows.length }];
  });
  const hour = now.getHours();
  const name = coach.name.split(" ")[0];
  const greeting = hour < 12 ? t("Morning, {name}", { name }) : hour < 18 ? t("Afternoon, {name}", { name }) : t("Evening, {name}", { name });

  return (
    <main className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-muted">{now.toLocaleDateString(LOCALE[activeSettings().language], { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="truncate text-[26px] font-bold tracking-tight">{greeting}</h1>
        </div>
        <form action={signOut}>
          <button type="submit" className="h-10 rounded-xl border border-border px-3 text-[13px] text-muted">
            {t("Sign out")}
          </button>
        </form>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat href={firstReview ? phoneHref(firstReview) : "/a/coach/athletes"} value={toReview} label={t("to review")} accent />
        <Stat href="/a/coach/chats" value={unread} label={t("unread")} />
        <Stat href="/a/coach/meets" value={next ? next.meet!.days : "—"} label={next ? t("days to {meet}", { meet: next.meet!.name }) : t("no meet")} />
      </div>

      <section className="flex flex-col gap-2">
        <Heading>{t("NEEDS YOU")}</Heading>
        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-[14px] text-muted">{t("Nothing waiting on you.")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.slice(0, 12).map((item) => {
              const chip = CHIP[item.kind];
              return (
                <li key={item.key}>
                  <Link href={phoneHref(item)} className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-2.5 active:bg-surface-2">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold">{initials(item.athlete)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{item.athlete}</span>
                      <span className="line-clamp-2 text-[13px] text-muted">{item.text}</span>
                    </span>
                    {item.urgent ? (
                      <span className="shrink-0 rounded-full bg-miss/15 px-2.5 py-1 text-[12px] font-semibold text-miss">{t("Today")}</span>
                    ) : (
                      chip && <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${chip.className}`}>{t(chip.label)}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {trainingToday.length > 0 && (
        <section className="flex flex-col gap-2">
          <Heading>{t("TRAINING TODAY")}</Heading>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {trainingToday.map((s) => (
              <Link key={s.athlete.id} href={`/a/coach/${s.athlete.id}/training`} className="flex w-52 shrink-0 flex-col gap-1.5 rounded-2xl border border-border bg-surface p-3.5">
                <span className="truncate text-[13px] text-muted">{s.athlete.name}</span>
                <span className="truncate text-[15px] font-semibold">{s.label}</span>
                <span className={`flex items-center gap-1.5 text-[12px] ${s.logged > 0 ? "text-ok" : "text-muted"}`}>
                  <span aria-hidden className={`size-1.5 rounded-full ${s.logged > 0 ? "bg-ok" : "bg-muted-2"}`} />
                  {s.logged > 0 ? t("{done} of {of} logged", { done: s.logged, of: s.of }) : t("not started")}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({ href, value, label, accent = false }: { href: string; value: number | string; label: string; accent?: boolean }) {
  return (
    <Link href={href} className="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-border bg-surface px-3 py-3">
      <span className={`text-[26px] font-bold tabular-nums ${accent && value !== 0 ? "text-accent" : ""}`}>{value}</span>
      <span className="truncate text-[12px] text-muted">{label}</span>
    </Link>
  );
}
