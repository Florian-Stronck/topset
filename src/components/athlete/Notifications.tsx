"use client";

import { useEffect, useState } from "react";
import { setPushPrefs, subscribePush, unsubscribePush } from "@/app/a/actions";
import { t } from "@/lib/i18n";
import type { PushKind, PushPrefs } from "@/lib/push-kinds";

/**
 * Push notifications in the athlete app: the service worker that shows them, the unread
 * count on the home-screen icon, and the bell that turns them on for this phone.
 */

const WORKER = "/a/sw.js";

function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The phone's worker, registered once per page load. */
function worker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(WORKER, { scope: "/a/" }).then(() => navigator.serviceWorker.ready);
}

/** A VAPID key as the push manager takes it. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function signup(sub: PushSubscription) {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } };
}

/**
 * Keeps the worker running and the home-screen icon's badge in step with the inbox. Lives
 * in the layout, so every page does it.
 */
export function AppBadge({ unread }: { unread: number }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) void worker().catch(() => {});
  }, []);
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (unread > 0) void nav.setAppBadge?.(unread).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
  }, [unread]);
  return null;
}

type State = "loading" | "unsupported" | "denied" | "off" | "on" | "busy";

/** The choices, in the order the panel lists them. */
const KINDS: { kind: PushKind; label: string; hint: string }[] = [
  { kind: "notes", label: "Notes from your coach", hint: "When your coach writes about a session." },
  { kind: "plan", label: "Plan changes", hint: "When your coach updates your program." },
  { kind: "reminder", label: "Training days", hint: "In the morning, when a session is planned." },
  { kind: "meets", label: "Meets", hint: "A week and a day before a competition." },
];

function zone(): string | undefined {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
}

/**
 * The small bell on the inbox. Tapping it turns notifications on for this phone and opens
 * the choices of what to hear about; each phone chooses for itself.
 */
export function NotifyBell({ token, vapidKey }: { token: string; vapidKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const settle = (next: State, got: PushPrefs | null = null) => {
      if (!live) return;
      setState(next);
      setPrefs(got);
    };
    void (async () => {
      if (!pushSupported()) return settle("unsupported");
      if (Notification.permission === "denied") return settle("denied");
      const sub = await worker()
        .then((reg) => reg.pushManager.getSubscription())
        .catch(() => null);
      if (!sub) return settle("off");
      // Already on: tell the server again, so a new link or a lost row picks it back up.
      const got = await subscribePush(token, signup(sub), zone()).catch(() => null);
      if (live && !got) setError(t("Couldn't load your choices. Try again later."));
      settle("on", got);
    })();
    return () => {
      live = false;
    };
  }, [token]);

  async function turnOn() {
    setError(null);
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await worker();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) }));
      setPrefs(await subscribePush(token, signup(sub), zone()));
      setState("on");
      setOpen(true);
    } catch {
      setError(t("Couldn't change notifications. Try again."));
      setState("off");
    }
  }

  async function turnOff() {
    setError(null);
    setState("busy");
    try {
      const sub = await (await worker()).pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(token, sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setPrefs(null);
      setOpen(false);
    } catch {
      setError(t("Couldn't change notifications. Try again."));
      setState("on");
    }
  }

  async function choose(kind: PushKind, value: boolean) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [kind]: value });
    try {
      const sub = await (await worker()).pushManager.getSubscription();
      if (!sub) throw new Error("gone");
      setPrefs(await setPushPrefs(token, sub.endpoint, { [kind]: value }));
    } catch {
      setPrefs(before);
      setError(t("Couldn't change notifications. Try again."));
    }
  }

  const on = state === "on";
  const blocked = state === "unsupported" || state === "denied";
  const hint =
    state === "unsupported"
      ? t("To get notifications, add this page to your Home Screen and open it from there.")
      : state === "denied"
        ? t("Notifications are blocked for this page. Allow them in your phone's settings.")
        : null;

  return (
    <div className="relative flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => (on ? setOpen(!open) : void turnOn())}
        disabled={state === "loading" || state === "busy" || blocked}
        aria-expanded={on ? open : undefined}
        title={on ? t("Notifications on") : t("Notifications off")}
        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] disabled:opacity-60 ${
          on ? "border-accent/50 bg-accent-soft text-accent" : "border-border bg-surface text-muted"
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          {!on && state !== "loading" && state !== "busy" && <path d="M3 3l18 18" />}
        </svg>
        {on ? t("On") : t("Notify me")}
      </button>
      {(hint || (error && !open)) && <p className="max-w-[240px] text-right text-[11px] leading-snug text-muted-2">{hint ?? error}</p>}

      {on && open && (
        <div className="absolute right-0 top-10 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-4 shadow-lg">
          <p className="text-[13px] font-semibold">{t("Notify me about")}</p>
          <ul className="mt-3 space-y-3">
            {KINDS.map(({ kind, label, hint: sub }) => {
              const checked = prefs?.[kind] ?? false;
              return (
                <li key={kind}>
                  <label className="flex cursor-pointer items-start justify-between gap-3">
                    <span>
                      <span className="block text-[14px] text-foreground">{t(label)}</span>
                      <span className="block text-[12px] leading-snug text-muted">{t(sub)}</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      aria-label={t(label)}
                      disabled={!prefs}
                      onClick={() => void choose(kind, !checked)}
                      className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${checked ? "bg-accent" : "bg-surface-3"}`}
                    >
                      <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`} />
                    </button>
                  </label>
                </li>
              );
            })}
          </ul>
          {error && <p className="mt-3 text-[12px] text-muted-2">{error}</p>}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <button type="button" onClick={() => void turnOff()} className="text-[12px] text-muted underline-offset-2 hover:underline">
              {t("Turn off on this phone")}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-white">
              {t("Done")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
