import { AthleteList, type AthleteRow } from "@/app/a/coach/athletes/AthleteList";
import { initials } from "@/app/a/coach/parts";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { currentBlock, startOfDay } from "@/lib/overview";
import { phoneAthletes, phoneCoach } from "@/lib/phone-coach";
import { chatSummary, getNextMeets, getOverview } from "@/lib/queries";
import { ROLE_LABEL } from "@/lib/roles";
import { daysBetween } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/** Every athlete the coach has, theirs and shared with them. */
export default async function PhoneAthletes() {
  const coach = await phoneCoach();
  if (!coach) return null;
  const now = new Date();
  const today = ymdOf(calendarToday());
  const [mine, { athletes }] = await Promise.all([phoneAthletes(coach.id), getOverview(now, coach.id)]);
  const ids = mine.map((a) => a.id);
  const [chats, meets] = await Promise.all([chatSummary(ids), getNextMeets(ids, startOfDay(now))]);
  const blocks = new Map(athletes.map((a) => [a.id, currentBlock(a.blocks, now, a.activeProgramId)]));

  const rows: AthleteRow[] = mine.map((a) => {
    const block = blocks.get(a.id);
    const meet = meets.get(a.id);
    return {
      id: a.id,
      name: a.name,
      initials: initials(a.name),
      program: block ? `${block.name} · ${block.phase}` : t("No program yet"),
      unread: chats.get(a.id)?.unread ?? 0,
      meetDays: meet ? daysBetween(today, ymdOf(meet.date)) : null,
      meetName: meet?.name ?? null,
      shared: a.share.role === "own" ? null : `${t("Shared by {name}", { name: a.share.owner })} · ${t(ROLE_LABEL[a.share.role])}`,
      linked: a.accessToken !== null,
    };
  });

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-[26px] font-bold tracking-tight">{t("Athletes")}</h1>
      <AthleteList rows={rows} />
    </main>
  );
}
