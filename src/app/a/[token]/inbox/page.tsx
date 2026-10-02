import { notFound } from "next/navigation";
import { Chat } from "@/components/athlete/Chat";
import { Meetings } from "@/components/athlete/Meetings";
import { NotifyBell } from "@/components/athlete/Notifications";
import { getAthleteByToken, inboxFor, meetingsFor } from "@/lib/athlete-queries";
import { athleteToday } from "@/lib/athlete-today";
import { loadSettings } from "@/lib/coach-settings";
import { t } from "@/lib/i18n";
import { vapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Meetings with the coach, then the chat: their notes on sessions and messages either way. */
export default async function AthleteChat({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const athlete = await getAthleteByToken(token);
  if (!athlete) notFound();
  await loadSettings(athlete.coachId);
  const [messages, meetings, today] = await Promise.all([inboxFor(athlete.id), meetingsFor(athlete.id), athleteToday()]);
  const vapidKey = vapidPublicKey();

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">{t("Chat")}</h1>
          <p className="mt-1 text-[13px] text-muted">{t("Talk with your coach.")}</p>
        </div>
        {vapidKey && <NotifyBell token={token} vapidKey={vapidKey} />}
      </div>
      <div className="mt-5">
        <Meetings token={token} meetings={meetings} today={today} />
        <Chat token={token} messages={messages} />
      </div>
    </div>
  );
}
