import { Sidebar } from "@/components/Sidebar";
import { OverviewMain } from "@/components/overview/OverviewMain";
import { OverviewTabs } from "@/components/OverviewTabs";
import { loadOverview } from "@/app/overview/data";
import { InsightsPane } from "@/app/overview/insights";
import { ChatPane, SchedulePane } from "@/app/overview/panes";
import { SEASON_WEEKS, SeasonPane } from "@/app/overview/season";
import { TodayPane } from "@/app/overview/today";
import { loadSettings } from "@/lib/coach-settings";
import { today as calendarToday, ymdOf } from "@/lib/dates";
import { LOCALE, t } from "@/lib/i18n";
import { OVERVIEW_TABS, type OverviewTab } from "@/lib/overview-tabs";
import { chatSummary, getMeetsBetween, getOverview, scheduleNews } from "@/lib/queries";
import { addDays } from "@/lib/schedule";
import { activeSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ tab?: string; athlete?: string }> }) {
  await loadSettings();
  const params = await searchParams;
  const tab: OverviewTab = OVERVIEW_TABS.includes(params.tab as OverviewTab) ? (params.tab as OverviewTab) : "athletes";
  const now = new Date();
  const today = ymdOf(calendarToday());
  const settings = activeSettings();
  const { coach, athletes, targetsByBlock, linked } = await getOverview(now);
  const ids = athletes.map((a) => a.id);
  const [chats, waiting] = await Promise.all([chatSummary(ids), scheduleNews(ids, today)]);
  const sum = (counts: Iterable<number>) => [...counts].reduce((a, b) => a + b, 0);
  const news = { schedule: sum(waiting.values()), chat: sum([...chats.values()].map((c) => c.unread)) };

  const frame = (body: React.ReactNode) => (
    <div className="flex h-screen">
      <Sidebar athletes={athletes} coachUsername={coach.username} coachName={coach.name} section="overview" />

      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1400px] px-6 py-7">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{t("Overview")}</h1>
            <p className="mt-1 text-[12px] text-muted">
              {now.toLocaleDateString(LOCALE[settings.language], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              {" · "}
              {t(athletes.length === 1 ? "{n} athlete" : "{n} athletes", { n: athletes.length })}
            </p>
          </div>
          <OverviewTabs tab={tab} news={news} />
          {body}
        </div>
      </main>
    </div>
  );

  const who = athletes.map((a) => ({ id: a.id, name: a.name, hasLink: linked.has(a.id), activeProgramId: a.activeProgramId }));
  if (tab === "chat") return frame(<ChatPane athletes={who} picked={params.athlete} chats={chats} />);
  if (tab === "schedule") return frame(<SchedulePane athletes={who} picked={params.athlete} news={waiting} today={today} />);

  const data = await loadOverview(now, { athletes, targetsByBlock, linked, chats, coachId: coach.id });
  if (tab === "today") return frame(<TodayPane data={data} athletes={athletes} now={now} />);
  if (tab === "insights") return frame(<InsightsPane data={data} names={new Map(athletes.map((a) => [a.id, a.name]))} />);
  if (tab === "season") {
    const from = new Date(`${data.thisWeek}T00:00:00`);
    const meets = await getMeetsBetween(ids, from, new Date(`${addDays(data.thisWeek, SEASON_WEEKS * 7)}T00:00:00`));
    return frame(<SeasonPane data={data} athletes={athletes} meets={meets} />);
  }
  return frame(<OverviewMain items={data.items} rows={data.rows} today={data.today} />);
}
