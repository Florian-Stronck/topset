"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { syncLight, syncNow } from "@/app/sync-actions";
import { useCommands, type Command } from "@/lib/commands";
import { t } from "@/lib/i18n";

type Light = Awaited<ReturnType<typeof syncLight>>;

/** How often the light asks whether everything is up. */
const POLL_MS = 1000;

/**
 * Whether the coach's edits are on the server: saved, saving, or not synced with the reason.
 * Clicking it (or Sync now) sends anything waiting and brings in what athletes logged.
 */
export function SyncLight() {
  const router = useRouter();
  const [light, setLight] = useState<Light | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      syncLight()
        .then((l) => alive && setLight(l))
        .catch(() => {});
    };
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const sync = () =>
    startTransition(async () => {
      // A cell still being typed in saves on blur, so it goes with this sync.
      (document.activeElement as HTMLElement | null)?.blur?.();
      await syncNow();
      setLight(await syncLight());
      router.refresh();
    });

  const commands = useMemo<Command[]>(
    () => [{ id: "refresh", group: "Sync", title: t("Sync now"), keywords: "save refresh reload check-ins sets phone", run: sync }],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );
  useCommands("refresh", commands);

  if (!light?.enabled) return null;
  const state = light.error ? "error" : busy || light.pending ? "saving" : "saved";
  const text = state === "error" ? t("Not synced") : state === "saving" ? t("Saving…") : t("Saved");
  const dot = state === "error" ? "bg-miss" : state === "saving" ? "bg-warn animate-pulse" : "bg-ok";
  const tip = state === "error" ? `${t("Not synced")}: ${light.error} · ${t("Click to try again")}` : t("Sync now");

  return (
    <button
      type="button"
      onClick={sync}
      title={tip}
      aria-label={tip}
      className={`fixed right-4 top-2 z-40 flex items-center gap-2 rounded-full px-2.5 py-1 text-[12px] hover:bg-surface-2 ${
        state === "error" ? "text-miss" : "text-muted"
      }`}
    >
      <span className={`size-2 rounded-full ${dot}`} />
      {text}
    </button>
  );
}
