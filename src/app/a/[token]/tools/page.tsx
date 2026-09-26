import { notFound } from "next/navigation";
import { E1rmCalculator } from "@/components/athlete/E1rmCalculator";
import { PlateCalculator } from "@/components/athlete/PlateCalculator";
import { ThemePicker } from "@/components/athlete/ThemePicker";
import { getAthleteByToken } from "@/lib/athlete-queries";
import { loadSettings } from "@/lib/coach-settings";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function AthleteTools({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const athlete = await getAthleteByToken(token);
  if (!athlete) notFound();
  await loadSettings(athlete.coachId);

  return (
    <div>
      <h1 className="text-[20px] font-semibold tracking-tight">{t("Tools")}</h1>
      <div className="mt-4 space-y-4">
        <PlateCalculator unit={athlete.unit} />
        <E1rmCalculator unit={athlete.unit} />
        <ThemePicker />
      </div>
    </div>
  );
}
