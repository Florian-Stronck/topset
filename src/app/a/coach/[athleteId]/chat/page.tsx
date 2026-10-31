import { redirect } from "next/navigation";

/** The athlete's chat lives under Chats, with the others. */
export default async function AthleteChat({ params }: { params: Promise<{ athleteId: string }> }) {
  redirect(`/a/coach/chats?athlete=${(await params).athleteId}`);
}
