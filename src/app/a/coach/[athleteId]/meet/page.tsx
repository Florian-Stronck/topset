import Link from "next/link";
import { athletePage } from "@/app/a/coach/[athleteId]/athlete";
import { PhoneActions } from "@/app/a/coach/PhoneActions";
import { PhoneAttempts } from "@/app/a/coach/PhoneAttempts";
import { Segmented } from "@/app/a/coach/parts";
import { plannerData } from "@/app/competition/data";
import { MeetPlanner } from "@/components/MeetPlanner";
import { COMPETITION_TABS, daysUntil, type CompetitionTab } from "@/lib/competition";
import { t } from "@/lib/i18n";
import { allows } from "@/lib/phone-coach";

export const dynamic = "force-dynamic";

/** The athlete's meets: meet day's attempts on the phone's own card; the road and history as on the desktop. */
export default async function MeetPage({
  params,
  searchParams,
}: {
  params: Promise<{ athleteId: string }>;
  searchParams: Promise<{ meet?: string; tab?: string }>;
}) {
  const page = await athletePage((await params).athleteId);
  if (!page) return null;
  const { athlete } = page;
  const query = await searchParams;
  const tab: CompetitionTab = COMPETITION_TABS.includes(query.tab as CompetitionTab) ? (query.tab as CompetitionTab) : "attempts";
  const data = await plannerData(athlete, query.meet, tab);
  const readOnly = !allows(athlete.share.role, "edit");
  const base = `/a/coach/${athlete.id}/meet`;
  const href = (next: { meet?: string; tab?: CompetitionTab }) => {
    const p = new URLSearchParams();
    const meet = next.meet ?? data.meet?.id;
    if (meet) p.set("meet", meet);
    if ((next.tab ?? tab) !== "attempts") p.set("tab", next.tab ?? tab);
    return `${base}${p.size ? `?${p}` : ""}`;
  };

  // No meet yet, or the road and history: the desktop's planner, which also adds meets.
  if (!data.meet || tab !== "attempts") {
    return (
      <PhoneActions clips={{}}>
        {data.meet && (
          <div className="mt-3">
            <Segmented
              label={t("Meet view")}
              options={COMPETITION_TABS.map((id) => ({ href: href({ tab: id }), label: t(id === "attempts" ? "Attempts" : id === "road" ? "Road" : "History"), on: id === tab }))}
            />
          </div>
        )}
        {/* The planner locks itself for a share, so another meet can still be picked. */}
        <div className="-mx-6 -mt-3">
          <MeetPlanner athlete={athlete} {...data} readOnly={readOnly} />
        </div>
      </PhoneActions>
    );
  }

  const now = new Date(data.today);
  return (
    <PhoneActions clips={{}}>
      <div className="mt-3 flex flex-col gap-3">
        <Segmented
          label={t("Meet view")}
          options={COMPETITION_TABS.map((id) => ({ href: href({ tab: id }), label: t(id === "attempts" ? "Attempts" : id === "road" ? "Road" : "History"), on: id === tab }))}
        />
        {data.meets.length > 1 && (
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {data.meets.map((m) => (
              <Link
                key={m.id}
                href={href({ meet: m.id })}
                scroll={false}
                aria-current={m.id === data.meet!.id ? "page" : undefined}
                className={`flex h-8 shrink-0 items-center rounded-full border px-3 text-[12px] ${m.id === data.meet!.id ? "border-accent text-accent" : "border-border text-muted"}`}
              >
                {m.name}
                {daysUntil(m.date, now) >= 0 && ` · ${daysUntil(m.date, now)} d`}
              </Link>
            ))}
          </div>
        )}
        <h2 className="text-[20px] font-bold">{data.meet.name}</h2>
        <PhoneAttempts key={data.meet.id} athlete={athlete} meet={data.meet} readOnly={readOnly} />
      </div>
    </PhoneActions>
  );
}
