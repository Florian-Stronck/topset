"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";

const PAGES = [
  { path: "", label: "Overview" },
  { path: "/training", label: "Training" },
  { path: "/body", label: "Body" },
  { path: "/schedule", label: "Schedule" },
  { path: "/meet", label: "Meet" },
] as const;

/** One athlete's pages, under their name. */
export function AthleteTabs({ athleteId }: { athleteId: string }) {
  const path = usePathname();
  const base = `/a/coach/${athleteId}`;
  return (
    <nav aria-label={t("Athlete pages")} className="-mx-4 flex gap-1.5 overflow-x-auto border-b border-border px-4 pb-3 pt-1">
      {PAGES.map((p) => {
        const on = path === base + p.path;
        return (
          <Link
            key={p.path}
            href={base + p.path}
            aria-current={on ? "page" : undefined}
            className={`flex h-9 shrink-0 items-center rounded-full px-4 text-[13px] ${on ? "bg-accent font-semibold text-white" : "bg-surface-2 text-muted"}`}
          >
            {t(p.label)}
          </Link>
        );
      })}
    </nav>
  );
}
