import Link from "next/link";
import { PhoneActions } from "@/app/a/coach/PhoneActions";
import { initials } from "@/app/a/coach/parts";
import { ChatView } from "@/components/tracking/ChatView";
import { loadSettings } from "@/lib/coach-settings";
import { t } from "@/lib/i18n";
import { allows, phoneAthletes, phoneCoach } from "@/lib/phone-coach";
import { chatSummary, getMessages } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Every chat in one place: pick the athlete along the top, their thread below. */
export default async function PhoneChats({ searchParams }: { searchParams: Promise<{ athlete?: string }> }) {
  const coach = await phoneCoach();
  if (!coach) return null;
  await loadSettings(coach.id);
  const athletes = await phoneAthletes(coach.id);
  const chats = await chatSummary(athletes.map((a) => a.id));
  const { athlete: asked } = await searchParams;
  // The one asked for, else whoever wrote last and isn't read yet, else whoever wrote last.
  const byLast = [...athletes].sort((a, b) => (chats.get(b.id)?.last?.createdAt ?? "").localeCompare(chats.get(a.id)?.last?.createdAt ?? ""));
  const picked = athletes.find((a) => a.id === asked) ?? byLast.find((a) => (chats.get(a.id)?.unread ?? 0) > 0) ?? byLast[0];

  if (!picked) {
    return (
      <main>
        <h1 className="text-[26px] font-bold tracking-tight">{t("Chats")}</h1>
        <p className="mt-8 text-center text-[14px] text-muted">{t("No athletes yet. Add them in the desktop app; they show up here once it has synced.")}</p>
      </main>
    );
  }
  const messages = await getMessages(picked.id);
  const unread = messages.filter((m) => m.sender === "athlete" && !m.readAt).length;

  return (
    <main className="flex flex-col">
      <h1 className="text-[26px] font-bold tracking-tight">{t("Chats")}</h1>
      <nav aria-label={t("Athletes")} className="-mx-4 mt-3 flex gap-4 overflow-x-auto border-b border-border px-4 pb-3">
        {byLast.map((a) => {
          const on = a.id === picked.id;
          const count = chats.get(a.id)?.unread ?? 0;
          return (
            <Link key={a.id} href={`/a/coach/chats?athlete=${a.id}`} scroll={false} aria-current={on ? "page" : undefined} className="relative flex w-14 shrink-0 flex-col items-center gap-1.5">
              <span className={`grid size-12 place-items-center rounded-full border-2 bg-surface-2 font-semibold ${on ? "border-accent" : "border-transparent"}`}>{initials(a.name)}</span>
              <span className={`w-full truncate text-center text-[12px] ${on ? "text-foreground" : "text-muted"}`}>{a.name.split(" ")[0]}</span>
              {count > 0 && <span className="absolute right-0 top-0 grid size-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-white">{count}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center justify-between pt-3">
        <Link href={`/a/coach/${picked.id}`} className="text-[15px] font-semibold">
          {picked.name} ›
        </Link>
      </div>
      {/* The composer sits above the bottom bar, not under it. */}
      <div className="[&_.sticky]:bottom-[calc(64px+env(safe-area-inset-bottom))]">
        <PhoneActions clips={{}}>
          {allows(picked.share.role, "review") ? (
            <ChatView key={picked.id} athlete={{ id: picked.id, name: picked.name }} messages={messages} unread={unread} hasLink={picked.accessToken !== null} />
          ) : (
            <p className="mt-6 rounded-xl border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted">{t("Shared with you to look at: nothing can be changed here.")}</p>
          )}
        </PhoneActions>
      </div>
    </main>
  );
}
