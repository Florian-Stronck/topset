/** What a phone can choose to hear about from the athlete app; each is a column of PushSubscription. */
export const PUSH_KINDS = ["notes", "plan", "reminder", "meets"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export type PushPrefs = Record<PushKind, boolean>;

/** The browsers' own push services. A sign-up pointing anywhere else would have the server call it. */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  ".push.services.mozilla.com",
  ".notify.windows.com",
  ".push.apple.com",
];

export function pushServiceEndpoint(endpoint: string): boolean {
  const url = URL.parse(endpoint);
  if (!url || url.protocol !== "https:" || url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h));
}
