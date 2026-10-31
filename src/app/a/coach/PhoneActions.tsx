"use client";

import { useMemo } from "react";
import * as phone from "@/app/a/coach/actions";
import { CoachActionsProvider } from "@/components/CoachActions";
import type { ClipView } from "@/lib/athlete-videos";
import type { CompetitionTab } from "@/lib/competition";

// ponytail: the chat re-renders its page on every poll; ask the server for news first if that costs.
const pollChat = async () => true;

/** A meet's tab on the phone: the athlete's Meet page. */
function meetHref(athleteId: string, meetId: string | null, tab: CompetitionTab = "attempts") {
  const p = new URLSearchParams();
  if (meetId) p.set("meet", meetId);
  if (tab !== "attempts") p.set("tab", tab);
  return `/a/coach/${athleteId}/meet${p.size ? `?${p}` : ""}`;
}

/** Tracking and the chat on the phone, writing through the server's own actions. */
export function PhoneActions({ clips, children }: { clips: Record<string, ClipView[]>; children: React.ReactNode }) {
  const actions = useMemo(() => ({ ...phone, pollChat, phone: true, clips, meetHref }), [clips]);
  return <CoachActionsProvider actions={actions}>{children}</CoachActionsProvider>;
}
