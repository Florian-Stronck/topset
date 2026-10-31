import Link from "next/link";
import { AthleteTabs } from "@/app/a/coach/[athleteId]/AthleteTabs";
import { athletePage } from "@/app/a/coach/[athleteId]/athlete";
import { t } from "@/lib/i18n";
import { getWorkspace } from "@/lib/queries";
import { ROLE_LABEL } from "@/lib/roles";

const icon = "grid size-11 shrink-0 place-items-center rounded-full text-muted active:bg-surface-2";

/** One athlete: their name and current program on top, chat and profile beside it, their pages below. */
export default async function PhoneAthleteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ athleteId: string }> }) {
  const { athleteId } = await params;
  const page = await athletePage(athleteId);
  if (!page) return null;
  const { athlete } = page;
  const { program, phase } = await getWorkspace(athlete.id);

  return (
    <>
      <header className="-mx-2 flex items-center gap-1">
        <Link href="/a/coach/athletes" aria-label={t("Athletes")} className={icon}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[20px] font-bold tracking-tight">{athlete.name}</h1>
          <p className="truncate text-[12px] text-muted">
            {[program && phase ? `${program.name} · ${phase.phase}` : t("No program yet"), athlete.share.role !== "own" ? t(ROLE_LABEL[athlete.share.role]) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Link href={`/a/coach/chats?athlete=${athlete.id}`} aria-label={t("Chat")} className={icon}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 5h16v11H9l-5 4z" />
          </svg>
        </Link>
        <Link href={`/a/coach/${athlete.id}/profile`} aria-label={t("Profile")} className={icon}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1-4 4-6 8-6s7 2 8 6" />
          </svg>
        </Link>
      </header>
      <AthleteTabs athleteId={athlete.id} />
      {children}
    </>
  );
}
