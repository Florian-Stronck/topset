import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadSettings } from "@/lib/coach-settings";
import { t } from "@/lib/i18n";
import { ATHLETE_COOKIE } from "@/lib/athlete-cookies";

export const dynamic = "force-dynamic";

/** The home-screen entry: straight to the athlete's own page once a link has been opened here. */
export default async function AthleteHome() {
  const token = (await cookies()).get(ATHLETE_COOKIE)?.value;
  if (token) redirect(`/a/${encodeURIComponent(token)}`);
  await loadSettings();

  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <div className="text-[18px] font-semibold">{t("Topset Check-in")}</div>
        <p className="mt-2 text-[14px] text-muted">{t("Open the link your coach sent you to see your training.")}</p>
      </div>
    </main>
  );
}
