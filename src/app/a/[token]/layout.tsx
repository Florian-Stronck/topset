import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { AthleteNav } from "@/components/athlete/AthleteNav";
import { RememberAthlete } from "@/components/athlete/RememberAthlete";
import { SettingsProvider } from "@/components/SettingsProvider";
import { getAthleteByToken } from "@/lib/athlete-queries";
import { loadSettings } from "@/lib/coach-settings";
import { forClient } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Topset Check-in",
  manifest: "/a/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Topset",
    statusBarStyle: "black-translucent",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0c",
};

export default async function AthleteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const athlete = await getAthleteByToken(token);
  if (!athlete) notFound();
  // The athlete sees their own coach's units, rounding, RPE chart and language.
  const settings = await loadSettings(athlete.coachId);

  return (
    <SettingsProvider settings={forClient(settings)}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
        <RememberAthlete token={token} />
        <div className="flex-1 px-4 pb-28 pt-[max(16px,env(safe-area-inset-top))]">
          {children}
        </div>
        <AthleteNav token={token} />
      </div>
    </SettingsProvider>
  );
}
