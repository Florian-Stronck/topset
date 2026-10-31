import Link from "next/link";
import { t } from "@/lib/i18n";
import { allows, type Need } from "@/lib/phone-coach";
import type { AthleteShareInfo } from "@/lib/share";

/**
 * Bits every phone page lays out the same way: the lock a share puts on a page, a two- or
 * three-way switch, the phase picker and a section heading.
 */

/** Shared to view: nothing changes. To review: only marks, notes and the chat do. */
export function Locked({ role, need, children }: { role: AthleteShareInfo["role"]; need: Need; children: React.ReactNode }) {
  if (allows(role, need)) return children;
  return (
    <>
      <p className="mt-3 rounded-xl border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted">
        {role === "review"
          ? t("Shared with you to review: mark sessions reviewed and write to them in Review.")
          : t("Shared with you to look at: nothing can be changed here.")}
      </p>
      <div inert className="contents">
        {children}
      </div>
    </>
  );
}

/** A switch between views of one page, each its own link so Back goes back. */
export function Segmented({ label, options }: { label: string; options: { href: string; label: string; on: boolean }[] }) {
  return (
    <nav aria-label={label} className="grid rounded-xl bg-surface p-[3px]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          scroll={false}
          aria-current={o.on ? "page" : undefined}
          className={`grid h-9 place-items-center rounded-[9px] text-[14px] ${o.on ? "bg-surface-3 font-semibold text-foreground" : "text-muted"}`}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

/** Every phase of every program, to pick the one a page shows. */
export function PhaseChips({
  programs,
  current,
  href,
}: {
  programs: { name: string; phases: { id: string; phase: string }[] }[];
  current: string | undefined;
  href: (phaseId: string) => string;
}) {
  const all = programs.flatMap((p) => p.phases.map((ph) => ({ id: ph.id, label: programs.length > 1 ? `${p.name} · ${ph.phase}` : ph.phase })));
  if (all.length < 2) return null;
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
      {all.map((ph) => (
        <Link
          key={ph.id}
          href={href(ph.id)}
          scroll={false}
          aria-current={ph.id === current ? "page" : undefined}
          className={`flex h-8 shrink-0 items-center rounded-full border px-3 text-[12px] ${ph.id === current ? "border-accent text-accent" : "border-border text-muted"}`}
        >
          {ph.label}
        </Link>
      ))}
    </div>
  );
}

export function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[12px] font-semibold tracking-[0.12em] text-muted">{children}</h2>;
}

/** Initials for an athlete's round badge. */
export const initials = (name: string) =>
  name
    .replace(/[^\p{L}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
