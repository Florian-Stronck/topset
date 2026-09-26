import { notFound } from "next/navigation";
import { CoachNotes } from "@/components/athlete/CoachNotes";
import { NotifyBell } from "@/components/athlete/Notifications";
import { getAthleteByToken, inboxFor } from "@/lib/athlete-queries";
import { loadSettings } from "@/lib/coach-settings";
import { t } from "@/lib/i18n";
import { vapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Every note the coach wrote about the athlete's sessions, newest first. */
export default async function AthleteInbox({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const athlete = await getAthleteByToken(token);
  if (!athlete) notFound();
  await loadSettings(athlete.coachId);
  const messages = await inboxFor(athlete.id);
  const vapidKey = vapidPublicKey();

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">{t("Inbox")}</h1>
          <p className="mt-1 text-[13px] text-muted">{t("What your coach said about your sessions.")}</p>
        </div>
        {vapidKey && <NotifyBell token={token} vapidKey={vapidKey} />}
      </div>
      <div className="mt-5">
        {messages.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">
            {t("Nothing yet. When your coach reviews a session and leaves a note, it shows up here.")}
          </p>
        ) : (
          <CoachNotes token={token} messages={messages} linkToSession />
        )}
      </div>
    </div>
  );
}
