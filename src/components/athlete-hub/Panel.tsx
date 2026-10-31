import type { ReactNode } from "react";

/** One titled card of the athlete hub: a heading, a line on what it is, and what's on the right. */
export function Panel({ title, hint, aside, children }: { title: ReactNode; hint?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
