"use client";

import { createContext, useContext } from "react";
import * as questions from "@/app/athletes/actions";
import * as links from "@/app/athletes/link-actions";
import * as competition from "@/app/competition/actions";
import { updateAthlete } from "@/app/programming/actions";
import { syncChat } from "@/app/sync-actions";
import * as tracking from "@/app/tracking/actions";
import type { ClipView } from "@/lib/athlete-videos";
import { competitionHref, type CompetitionTab } from "@/lib/competition";

/**
 * The writes Tracking, the chat, the schedule, meets and the athlete app's setup make, and where they run: the desktop
 * app's own actions, or on the coach's phone (`/a/coach`) the server's — same names, same
 * arguments, checked against the signed-in coach there.
 */
export type CoachActions = Pick<
  typeof tracking,
  | "addBodyweight"
  | "deleteBodyweight"
  | "saveNutrition"
  | "markReviewed"
  | "sendMessage"
  | "sendChatMessage"
  | "markChatRead"
  | "editMessage"
  | "deleteMessage"
  | "saveCoachInjury"
  | "deleteCoachInjury"
  | "markMovesSeen"
  | "undoMove"
  | "proposeMeeting"
  | "rescheduleMeeting"
  | "answerAthleteMeeting"
  | "cancelCoachMeeting"
  | "deleteCoachMeeting"
> &
  typeof competition &
  Pick<typeof questions, "addCheckinQuestion" | "updateCheckinQuestion" | "removeCheckinQuestion" | "reorderCheckinQuestions"> &
  Pick<typeof links, "athleteLink" | "createAccessLink" | "revokeAccessLink"> & {
    updateAthlete: typeof updateAthlete;
    /** Whether the chat has news to show: the desktop app pulls it from the server first. */
    pollChat: () => Promise<boolean>;
    /** On the coach's phone, where links and files on this computer don't exist. */
    phone: boolean;
    /** On the phone: the athlete's clips per row, played from storage, in place of the desktop's own video files. */
    clips: Record<string, ClipView[]>;
    /** Where a meet's tab is: the Competition screen, or the phone's Meet tab. */
    meetHref: (athleteId: string, meetId: string | null, tab?: CompetitionTab) => string;
  };

const DESKTOP: CoachActions = { ...tracking, ...competition, ...questions, ...links, updateAthlete, pollChat: syncChat, phone: false, clips: {}, meetHref: competitionHref };

const Actions = createContext<CoachActions>(DESKTOP);

export const useCoachActions = () => useContext(Actions);

export function CoachActionsProvider({ actions, children }: { actions: CoachActions; children: React.ReactNode }) {
  return <Actions.Provider value={actions}>{children}</Actions.Provider>;
}
