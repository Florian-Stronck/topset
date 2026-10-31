import { athletePage } from "@/app/a/coach/[athleteId]/athlete";
import { PhoneActions } from "@/app/a/coach/PhoneActions";
import { PhoneProfile } from "@/app/a/coach/PhoneProfile";
import { Heading, Locked } from "@/app/a/coach/parts";
import { AthleteLinkPanel } from "@/components/AthleteLink";
import { CheckinQuestions } from "@/components/CheckinQuestions";
import { questionData } from "@/lib/checkins";
import { t } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Profile: 1RMs, division and notes, then the athlete app's setup — its questions and the link. */
export default async function ProfilePage({ params }: { params: Promise<{ athleteId: string }> }) {
  const page = await athletePage((await params).athleteId);
  if (!page) return null;
  const { athlete } = page;
  const questions = (
    await prisma.checkinQuestion.findMany({ where: { athleteId: athlete.id, archived: false }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] })
  ).map(questionData);

  return (
    <PhoneActions clips={{}}>
      <Locked role={athlete.share.role} need="edit">
        <PhoneProfile athlete={athlete} />
        <section className="mt-6 flex flex-col gap-2">
          <Heading>{t("CHECK-INS")}</Heading>
          <p className="text-[12px] text-muted">{t("What the athlete app asks before training. Scales feed the readiness score.")}</p>
          <CheckinQuestions athleteId={athlete.id} questions={questions} />
        </section>
        <section className="mt-6 flex flex-col gap-2">
          <Heading>{t("Check-in link")}</Heading>
          <p className="text-[12px] text-muted">{t("They open it on their phone to see their training and log every set. You see it here.")}</p>
          <AthleteLinkPanel athleteId={athlete.id} />
        </section>
      </Locked>
    </PhoneActions>
  );
}
