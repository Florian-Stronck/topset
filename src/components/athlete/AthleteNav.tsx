"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";

/** The three screens, as a thumb-reach bar along the bottom. */
export function AthleteNav({ token }: { token: string }) {
  const path = usePathname();
  const base = `/a/${token}`;
  const tabs = [
    { href: base, label: t("Today"), icon: "M4 6h16M4 12h16M4 18h10" },
    { href: `${base}/history`, label: t("History"), icon: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
    { href: `${base}/tools`, label: t("Tools"), icon: "M4 20h16M7 16V8M12 16V4M17 16v-6" },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-[560px] grid-cols-3">
        {tabs.map((tab) => {
          const active = tab.href === base ? path === base : path.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={tab.icon} />
              </svg>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
