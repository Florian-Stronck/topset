"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";

type Section = "home" | "athletes" | "chats" | "meets";

/** Which part of the phone app a page belongs to: an athlete's meet counts as Meets. */
function sectionOf(path: string): Section {
  if (path === "/a/coach") return "home";
  if (path.startsWith("/a/coach/chats")) return "chats";
  if (path.startsWith("/a/coach/meets") || path.endsWith("/meet")) return "meets";
  return "athletes";
}

const ICON: Record<Section, React.ReactNode> = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  athletes: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c1.9.6 3.1 2.6 3.5 5.5" />
    </>
  ),
  chats: <path d="M4 5h16v11H9l-5 4z" />,
  meets: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8" />,
};

const ITEMS: { id: Section; href: string; label: string }[] = [
  { id: "home", href: "/a/coach", label: "Home" },
  { id: "athletes", href: "/a/coach/athletes", label: "Athletes" },
  { id: "chats", href: "/a/coach/chats", label: "Chats" },
  { id: "meets", href: "/a/coach/meets", label: "Meets" },
];

/** The phone app's four places, along the bottom of every page. */
export function BottomNav({ unread }: { unread: number }) {
  const on = sectionOf(usePathname());
  return (
    <nav
      aria-label={t("Main")}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid h-16 max-w-[960px] grid-cols-4">
        {ITEMS.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={item.id === on ? "page" : undefined}
            className={`relative flex flex-col items-center justify-center gap-1 text-[11px] ${item.id === on ? "font-semibold text-accent" : "text-muted"}`}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {ICON[item.id]}
            </svg>
            {t(item.label)}
            {item.id === "chats" && unread > 0 && (
              <span className="absolute left-1/2 top-1.5 ml-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{unread}</span>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}
