/** What a phone can choose to hear about from the athlete app; each is a column of PushSubscription. */
export const PUSH_KINDS = ["notes", "plan", "reminder", "meets"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export type PushPrefs = Record<PushKind, boolean>;
