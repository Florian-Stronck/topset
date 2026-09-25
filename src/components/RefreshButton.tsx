"use client";

import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { syncNow } from "@/app/sync-actions";
import { useCommands, type Command } from "@/lib/commands";
import { t } from "@/lib/i18n";

/** Pulls in whatever athletes logged from their phones since the page was opened. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = () =>
    startTransition(async () => {
      await syncNow();
      router.refresh();
    });

  const commands = useMemo<Command[]>(
    () => [
      {
        id: "refresh",
        group: "Sync",
        title: t("Refresh what athletes logged"),
        keywords: "reload sync check-ins sets phone",
        run: refresh,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );
  useCommands("refresh", commands);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={refresh}
      className="rounded-full border border-border px-3 py-1 text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-60"
    >
      {pending ? t("Refreshing…") : t("Refresh")}
    </button>
  );
}
