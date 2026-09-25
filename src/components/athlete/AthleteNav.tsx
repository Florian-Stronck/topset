"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";

/** The four screens, as a thumb-reach bar along the bottom; the inbox counts what's unread. */
export function AthleteNav({ token, unread = 0 }: { token: string; unread?: number }) {
  const path = usePathname();
  const base = `/a/${token}`;
  const tabs = [
    { href: base, label: t("Today"), icon: "M4 6h16M4 12h16M4 18h10" },
    { href: `${base}/history`, label: t("History"), icon: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
    { href: `${base}/inbox`, label: t("Inbox"), icon: "M4 13h4l2 3h4l2-3h4M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5Z" },
    { href: `${base}/tools`, label: t("Tools"), icon: "M4 20h16M7 16V8M12 16V4M17 16v-6" },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-[560px] grid-cols-4">
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
              <span className="relative">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={tab.icon} />
                </svg>
                {tab.href.endsWith("/inbox") && unread > 0 && !active && (
                  <span
                    aria-label={t("{n} unread", { n: unread })}
                    className="absolute -right-2 -top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white"
                  >
                    {unread}
                  </span>
                )}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
