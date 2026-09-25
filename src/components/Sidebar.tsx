"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useContextMenu } from "@/components/ContextMenu";
import { useEffect, useMemo } from "react";
import { fresh, useCommands, type Command } from "@/lib/commands";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";
import { togglePref, usePref } from "@/lib/prefs";
import { LAST_SCREEN_COOKIE } from "@/lib/athlete-cookies";
import { NewAthleteButton } from "@/components/Roster";
import { startTutorial, Tutorial } from "@/components/Tutorial";
import { t } from "@/lib/i18n";

type Athlete = { id: string; name: string };

/** Small enough to read at 16px, and drawn rather than lettered so a collapsed rail
 *  still says what each screen is. */
const ICON: Record<string, React.ReactNode> = {
  overview: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  ),
  athletes: (
    <>
      <circle cx="8" cy="5" r="2.6" />
      <path d="M2.8 14c0-2.7 2.3-4.4 5.2-4.4s5.2 1.7 5.2 4.4" />
    </>
  ),
  programming: (
    <>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />
    </>
  ),
  tracking: (
    <>
      <path d="M2.5 11.5l3.5-4 2.5 2.5 5-6" />
      <path d="M2.5 2.5v11h11" />
    </>
  ),
  competition: (
    <>
      <path d="M4.5 2.5h7v3a3.5 3.5 0 0 1-7 0z" />
      <path d="M8 9v2.5M5.5 13.5h5" />
    </>
  ),
};

const NAV = [
  { label: "Overview", href: "/overview", key: "overview" },
  { label: "Athletes", href: "/athletes", key: "athletes" },
  { label: "Programming", href: "/programming", key: "programming" },
  { label: "Tracking", href: "/tracking", key: "tracking" },
  { label: "Competition", href: "/competition", key: "competition" },
];

/** Switching athlete keeps you on the screen you are on. */
const SECTION_HREF: Record<string, string> = {
  overview: "/programming",
  athletes: "/programming",
  programming: "/programming",
  tracking: "/tracking",
  competition: "/competition",
  settings: "/programming",
};


export function Sidebar({
  athletes,
  activeAthleteId,
  coachUsername,
  coachName,
  section = "programming",
  keep,
}: {
  athletes: Athlete[];
  activeAthleteId?: string;
  coachUsername: string;
  coachName?: string;
  section?: "overview" | "athletes" | "programming" | "tracking" | "competition" | "settings";
  /** Query kept when switching athlete, such as Tracking's open view (`view=progress`). */
  keep?: string;
}) {
  const router = useRouter();
  const athleteMenu = useContextMenu();

  // Getting around, from any screen's palette.
  const commands = useMemo<Command[]>(() => {
    const withAthlete = (href: string) => (activeAthleteId ? `${href}?athlete=${activeAthleteId}` : href);
    const go = (id: string, title: string, href: string, keywords?: string): Command => ({
      id,
      group: "Go",
      title: t(title),
      keywords,
      kind: "place",
      run: () => router.push(href),
    });
    const inSection = (id: string) => `${SECTION_HREF[section] ?? "/programming"}?athlete=${id}${keep ? `&${keep}` : ""}`;
    const at = athletes.findIndex((a) => a.id === activeAthleteId);
    const step = (by: 1 | -1) => {
      if (athletes.length === 0) return;
      // Round the roster, the way Tracking's arrows go.
      const next = athletes[(Math.max(at, 0) + by + athletes.length) % athletes.length];
      router.push(inSection(next.id));
    };
    return [
      go("go-overview", "Overview", "/overview", "home dashboard blocks attention"),
      go("go-athletes", "The roster", "/athletes", "athletes list"),
      go("go-programming", "Programming", withAthlete("/programming"), "program grid sheet"),
      go("go-tracking", "Tracking", withAthlete("/tracking"), "logged rpe e1rm compliance"),
      go("go-competition", "Competition", withAthlete("/competition"), "meet attempts openers total"),
      go("go-settings", "Settings", "/settings", "preferences options"),
      {
        id: "athlete-new",
        group: "Athlete",
        title: t("New athlete…"),
        keywords: "add create roster",
        // The nonce reopens the form even when the roster is already on screen.
        run: () => router.push(fresh(`/athletes?new=1`)),
      },
      {
        id: "tutorial",
        group: "Help",
        title: t("Start the tutorial"),
        keywords: "help tour guide how learn",
        run: startTutorial,
      },
      // Straight to a part of the settings, from anywhere. The admin's own page is left out:
      // who is admin isn't known here.
      ...SETTINGS_SECTIONS.filter((s) => !("admin" in s)).map((s) =>
        go(`settings-${s.id}`, `${t("Settings")}: ${t(s.title)}`, `/settings#${s.id}`, "preferences options"),
      ),
      { id: "athlete-prev", group: "Athlete", title: t("Previous athlete"), run: () => step(-1) },
      { id: "athlete-next", group: "Athlete", title: t("Next athlete"), run: () => step(1) },
      ...athletes
        .filter((a) => a.id !== activeAthleteId)
        .map((a): Command => ({
          id: `open-athlete-${a.id}`,
          group: "Athlete",
          title: t("Switch to {name}", { name: a.name }),
          kind: "athlete",
          run: () => router.push(inSection(a.id)),
        })),
    ];
  }, [athletes, activeAthleteId, keep, router, section]);
  useCommands("sidebar", commands);

  // Remembered for "open where I left off" — a cookie, so the server can read it at "/".
  useEffect(() => {
    if (section === "settings") return;
    document.cookie = `${LAST_SCREEN_COOKIE}=${encodeURIComponent(location.pathname + location.search)}; path=/; max-age=31536000; samesite=lax`;
  });

  // A per-computer pref: the server renders it open, and the browser corrects that
  // once it has read how it was left.
  const collapsed = usePref("sidebarCollapsed");
  const toggle = () => togglePref("sidebarCollapsed");

  return (
    <aside
      className={`flex h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150 ${
        collapsed ? "w-[60px]" : "w-[230px]"
      }`}
    >
      <div className={`flex items-start pt-6 pb-7 ${collapsed ? "px-3" : "px-5"}`}>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-[19px] font-bold tracking-tight">
              <span className="text-accent">T</span>opset
            </div>
            <div className="mt-1 text-[11px] font-medium tracking-[0.18em] text-muted-2">
              COACH WORKSPACE
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={toggle}
          title={collapsed ? t("Expand sidebar") : t("Collapse sidebar")}
          className={`grid size-7 shrink-0 place-items-center rounded-lg text-muted-2 hover:bg-surface-2 hover:text-foreground ${
            collapsed ? "mx-auto" : ""
          }`}
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={collapsed ? "M6 3.5L10.5 8 6 12.5" : "M10 3.5L5.5 8 10 12.5"} />
          </svg>
        </button>
      </div>

      <div data-tour="roster" className={`flex min-h-0 flex-col ${collapsed ? "px-2" : "px-5"}`}>
        {!collapsed && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-[0.18em] text-muted-2">ROSTER</span>
            <span className="text-[11px] text-muted-2">{athletes.length}</span>
          </div>
        )}

        <div className="mt-2 min-h-0 space-y-1 overflow-y-auto">
          {athletes.map((a) => (
            <Link
              key={a.id}
              onContextMenu={(e) =>
                athleteMenu.open(e, [
                  { label: t("Programming"), onSelect: () => router.push(`/programming?athlete=${a.id}`) },
                  { label: t("Tracking"), onSelect: () => router.push(`/tracking?athlete=${a.id}`) },
                  { label: t("Competition"), onSelect: () => router.push(`/competition?athlete=${a.id}`) },
                ])
              }
              href={`${SECTION_HREF[section] ?? "/programming"}?athlete=${a.id}${keep ? `&${keep}` : ""}`}
              title={collapsed ? a.name : undefined}
              className={`flex items-center gap-2 rounded-lg border text-[13px] ${
                collapsed ? "justify-center px-0 py-1.5" : "px-3 py-2"
              } ${
                a.id === activeAthleteId
                  ? "border-border bg-surface-2 text-foreground"
                  : "border-transparent text-muted hover:bg-surface-2"
              }`}
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
                {a.name.slice(0, 1).toUpperCase()}
              </span>
              {!collapsed && <span className="truncate">{a.name}</span>}
            </Link>
          ))}
        </div>

        {!collapsed && (
          <div className="mt-1.5">
            <NewAthleteButton compact />
          </div>
        )}
      </div>

      <nav data-tour="nav" className={`mt-8 ${collapsed ? "px-2" : "px-3"}`}>
        {!collapsed && (
          <div className="px-2 text-[11px] font-medium tracking-[0.18em] text-muted-2">
            WORKSPACE
          </div>
        )}
        <div className="mt-2 space-y-0.5">
          {NAV.map((item) => (
            <Link
              key={item.label}
              href={activeAthleteId ? `${item.href}?athlete=${activeAthleteId}` : item.href}
              title={collapsed ? t(item.label) : undefined}
              className={`flex items-center rounded-lg text-[13px] ${
                collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-3 py-2"
              } ${
                item.key === section
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-muted hover:bg-surface-2"
              }`}
            >
              <svg
                viewBox="0 0 16 16"
                className="size-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ICON[item.key]}
              </svg>
              {!collapsed && t(item.label)}
            </Link>
          ))}
        </div>
      </nav>

      <div className={`mt-auto ${collapsed ? "px-2" : "px-3"} pb-2`}>
        <button
          type="button"
          onClick={startTutorial}
          title={collapsed ? t("Tutorial") : t("A two-minute tour of Topset")}
          className={`flex w-full items-center rounded-lg text-[13px] text-muted hover:bg-surface-2 ${
            collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-3 py-2"
          }`}
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.3" />
            <path d="M8 11.4v.1" />
          </svg>
          {!collapsed && t("Tutorial")}
        </button>
      </div>

      <Tutorial section={section} athleteId={activeAthleteId} />

      {/* Who is signed in; the gear beside it is the way into Settings. */}
      <div className={`border-t border-border py-3 ${collapsed ? "px-2" : "px-3"}`}>
        <div className={`flex items-center ${collapsed ? "flex-col gap-1" : "gap-1"}`}>
          <Link
            href="/settings#account"
            title={collapsed ? `${coachName || coachUsername} · ${coachUsername}` : t("Your profile")}
            className={`flex min-w-0 flex-1 items-center rounded-lg hover:bg-surface-2 ${
              collapsed ? "justify-center p-1" : "gap-2.5 px-2 py-1.5"
            }`}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
              {(coachName || coachUsername).slice(0, 1).toUpperCase()}
            </span>
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium text-foreground">{coachName || coachUsername}</span>
                {coachName && <span className="block truncate text-[11px] text-muted-2">{coachUsername}</span>}
              </span>
            )}
          </Link>
          <Link
            href="/settings"
            title={t("Settings")}
            aria-label={t("Settings")}
            className={`grid size-8 shrink-0 place-items-center rounded-lg ${
              section === "settings" ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Link>
        </div>
      </div>
      {athleteMenu.menu}
    </aside>
  );
}
