import type { Metadata, Viewport } from "next";
import { after } from "next/server";
import { BottomNav } from "@/app/a/coach/BottomNav";
import { SignIn } from "@/app/a/coach/SignIn";
import { Swipe } from "@/app/a/coach/Swipe";
import { SettingsProvider } from "@/components/SettingsProvider";
import { cloudPrimary } from "@/lib/cloud";
import { loadSettings } from "@/lib/coach-settings";
import { t } from "@/lib/i18n";
import { phoneAthletes, phoneCoach } from "@/lib/phone-coach";
import { flushPlanNotices } from "@/lib/push";
import { chatSummary } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Topset Coach",
  appleWebApp: { capable: true, title: "Topset Coach", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0c",
};

/**
 * The coach's phone: Home, Athletes, Chats and Meets along the bottom, on the Topset
 * server, behind their own username and password.
 */
export default async function PhoneCoachLayout({ children }: { children: React.ReactNode }) {
  const coach = await phoneCoach();
  const settings = await loadSettings(coach?.id);

  if (!cloudPrimary() || !coach) {
    return (
      <SettingsProvider settings={settings}>
        <div className="mx-auto min-h-dvh w-full max-w-[960px] px-4 pt-[max(16px,env(safe-area-inset-top))]">
          {cloudPrimary() ? <SignIn /> : <p className="mt-24 text-center text-[14px] text-muted">{t("Open this on your athlete app's address, on your phone.")}</p>}
        </div>
      </SettingsProvider>
    );
  }

  // Plan changes made here reach the athletes once the coach has stopped editing, as the
  // desktop app's sync sees to while it is open.
  after(() => flushPlanNotices(coach.id).catch((e) => console.error("[topset] plan notice", e)));
  const athletes = await phoneAthletes(coach.id);
  const chats = await chatSummary(athletes.map((a) => a.id));
  const unread = [...chats.values()].reduce((n, c) => n + c.unread, 0);

  return (
    <SettingsProvider settings={settings}>
      <div className="mx-auto min-h-dvh w-full max-w-[960px] px-4 pb-[calc(88px+env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]">
        <Swipe>{children}</Swipe>
      </div>
      <BottomNav unread={unread} />
    </SettingsProvider>
  );
}
