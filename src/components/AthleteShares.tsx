"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { sharedWithOf } from "@/app/athletes/actions";
import { listShareCodes, manageShare, type ShareCodeListing } from "@/app/settings/cloud-actions";
import { Popover } from "@/components/Popover";
import { formKeys } from "@/components/cells";
import { ROLES, type Role } from "@/lib/roles";
import { plural, t } from "@/lib/i18n";

export const ROLE_LABEL: Record<Role, string> = { view: "Can view", review: "Can review", edit: "Can edit" };
const ROLE_HINT: Record<Role, string> = {
  view: "Sees everything, changes nothing.",
  review: "Also marks sessions reviewed and writes to the athlete.",
  edit: "Changes the plan too, like you.",
};

const field = "rounded border border-border bg-surface px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-accent/60";
const LASTS = [1, 7, 30, null] as const;

function RoleSelect({ value, onChange, disabled }: { value: Role; onChange: (role: Role) => void; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Role)} title={t(ROLE_HINT[value])} className={`min-w-0 cursor-pointer ${field}`}>
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {t(ROLE_LABEL[r])}
        </option>
      ))}
    </select>
  );
}

/**
 * Who else coaches this athlete, for their owner: the coaches it's shared with and what each
 * may do, and codes to share it with one more. Everything here happens on the server.
 */
export function ShareButton({
  athleteId,
  name,
  sharedWith,
  initiallyOpen = false,
}: {
  athleteId: string;
  name: string;
  sharedWith: { coachId: string; name: string; role: string }[];
  initiallyOpen?: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("Let another coach see or work on {name}", { name })}
        className={`rounded-lg border px-3 py-1.5 text-[12px] hover:border-accent hover:text-accent ${
          sharedWith.length ? "border-border text-muted" : "border-dashed border-border text-muted-2"
        }`}
      >
        {t("Coach access")}
      </button>
      <span className="flex items-center gap-1 text-[11px] text-muted-2">
        <span aria-hidden className={`size-1.5 rounded-full ${sharedWith.length ? "bg-ok" : "bg-muted-2"}`} />
        {sharedWith.length ? plural(sharedWith.length, "Shared with {n} coach", "Shared with {n} coaches") : t("not shared yet")}
      </span>
      {open && <ShareDialog athleteId={athleteId} name={name} open onClose={() => setOpen(false)} anchorRef={anchor} />}
    </>
  );
}

/** The share panel itself, opened from the button or from anywhere else, next to `anchorRef`. */
export function ShareDialog({
  athleteId,
  name,
  open,
  onClose,
  anchorRef,
}: {
  athleteId: string;
  name: string;
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const [sharedWith, setSharedWith] = useState<{ coachId: string; name: string; role: string }[]>([]);
  const [codes, setCodes] = useState<ShareCodeListing[] | null>(null);
  const [made, setMade] = useState<ShareCodeListing | null>(null);
  const [form, setForm] = useState<{ role: Role; reusable: boolean; days: number | null }>({ role: "view", reusable: false, days: 7 });
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Whenever it opens: who has it, and the codes still open.
  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      const [people, out] = await Promise.all([sharedWithOf(athleteId), listShareCodes()]);
      setSharedWith(people);
      setError(out.error ?? null);
      setCodes(out.codes.filter((c) => c.athleteId === athleteId));
    });
  }, [open, athleteId]);

  function act(run: () => Promise<{ error?: string }>, then?: () => void) {
    startTransition(async () => {
      const out = await run();
      setError(out.error ?? null);
      if (!out.error) {
        then?.();
        setSharedWith(await sharedWithOf(athleteId));
      }
    });
  }

  function makeCode() {
    startTransition(async () => {
      const out = await manageShare({ action: "code", athleteId, ...form });
      setError(out.error ?? null);
      if (out.code) {
        setMade(out.code);
        setCopied(false);
        setCodes((list) => [out.code!, ...(list ?? [])]);
      }
    });
  }

  return (
      <Popover open={open} onClose={onClose} anchorRef={anchorRef} width={320}>
        <div className="text-[13px] font-semibold">{t("Share {name}", { name })}</div>
        <p className="mt-1 text-[11px] text-muted">{t("Another coach on your Topset server enters the code to get {name} on their roster.", { name })}</p>

        {sharedWith.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {sharedWith.map((s) => (
              <div key={s.coachId} className="flex items-center gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <RoleSelect
                  value={(ROLES as readonly string[]).includes(s.role) ? (s.role as Role) : "view"}
                  disabled={pending}
                  onChange={(role) => act(() => manageShare({ action: "role", athleteId, coachId: s.coachId, role }))}
                />
                <button
                  type="button"
                  disabled={pending}
                  title={t("Stop sharing with {name}", { name: s.name })}
                  onClick={() => act(() => manageShare({ action: "remove", athleteId, coachId: s.coachId }))}
                  className="px-1 text-muted-2 hover:text-red-400"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {made ? (
          <div className="mt-3 rounded-lg border border-border bg-surface px-3 py-2.5">
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-[15px] tracking-wider">{made.code}</code>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(made.code);
                  setCopied(true);
                }}
                className="h-7 rounded bg-accent px-2 text-[11px] font-medium text-white"
              >
                {copied ? t("Copied") : t("Copy")}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              {t(ROLE_LABEL[made.role])} · {made.reusable ? t("for anyone who has it") : t("works once")} ·{" "}
              {made.expiresAt ? t("until {date}", { date: new Date(made.expiresAt).toLocaleDateString() }) : t("until you delete it")}
            </p>
            <button type="button" onClick={() => setMade(null)} className="mt-1.5 text-[11px] text-muted hover:text-foreground">
              {t("Make another")}
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-1.5" onKeyDown={formKeys(makeCode, onClose, pending)}>
            <div className="flex items-center gap-1.5">
              <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} />
              <select
                value={form.reusable ? "many" : "once"}
                onChange={(e) => setForm({ ...form, reusable: e.target.value === "many" })}
                className={`min-w-0 flex-1 cursor-pointer ${field}`}
              >
                <option value="once">{t("One coach")}</option>
                <option value="many">{t("Any number")}</option>
              </select>
              <select
                value={form.days ?? "never"}
                onChange={(e) => setForm({ ...form, days: e.target.value === "never" ? null : Number(e.target.value) })}
                className={`min-w-0 flex-1 cursor-pointer ${field}`}
              >
                {LASTS.map((d) => (
                  <option key={d ?? "never"} value={d ?? "never"}>
                    {d === null ? t("Never expires") : d === 1 ? t("1 day") : t("{n} days", { n: d })}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-muted-2">{t(ROLE_HINT[form.role])}</p>
            <button
              type="button"
              disabled={pending}
              onClick={makeCode}
              className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
            >
              {t("Make a code")}
            </button>
          </div>
        )}

        {codes && codes.length > 0 && (
          <div className="mt-3 border-t border-border pt-2">
            <div className="text-[10px] tracking-[0.14em] text-muted-2">{t("OPEN CODES")}</div>
            {codes.map((c) => (
              <div key={c.code} className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                <code className="font-mono text-foreground">{c.code}</code>
                <span className="min-w-0 flex-1 truncate">
                  {t(ROLE_LABEL[c.role])} · {c.reusable ? t("any number") : t("once")}
                  {c.expiresAt ? ` · ${t("until {date}", { date: new Date(c.expiresAt).toLocaleDateString() })}` : ""}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  title={t("Delete this code")}
                  onClick={() =>
                    act(
                      () => manageShare({ action: "dropCode", code: c.code }),
                      () => setCodes((list) => list?.filter((x) => x.code !== c.code) ?? null),
                    )
                  }
                  className="px-1 text-muted-2 hover:text-red-400"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      </Popover>
  );
}

/** For a coach given a code: enters it, and the athlete arrives with the next sync. */
export function EnterShareCode({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted hover:border-accent hover:text-accent"
      >
        {t("Enter share code")}
      </button>
      {open && <ShareCodeDialog open onClose={() => setOpen(false)} anchorRef={anchor} />}
    </>
  );
}

/** The code box itself, opened from the button or from anywhere else, next to `anchorRef`. */
export function ShareCodeDialog({ open, onClose, anchorRef }: { open: boolean; onClose: () => void; anchorRef: React.RefObject<HTMLElement | null> }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!code.trim()) return;
    startTransition(async () => {
      const out = await manageShare({ action: "redeem", code });
      setResult(out.error ? { error: out.error } : { ok: t("{name} is on your roster now.", { name: out.athlete ?? "" }) });
      if (!out.error) setCode("");
    });
  }

  return (
      <Popover open={open} onClose={onClose} anchorRef={anchorRef} width={280}>
        <div className="text-[13px] font-semibold">{t("Enter share code")}</div>
        <p className="mt-1 text-[11px] text-muted">{t("From the coach who shares an athlete with you.")}</p>
        <div className="mt-2.5 flex gap-1.5" onKeyDown={formKeys(submit, onClose, pending)}>
          <input
            autoFocus
            value={code}
            placeholder="ABCDE-FGHJK"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className={`min-w-0 flex-1 font-mono ${field}`}
          />
          <button
            type="button"
            disabled={pending || !code.trim()}
            onClick={submit}
            className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60"
          >
            {pending ? t("Adding…") : t("Add")}
          </button>
        </div>
        {result?.ok && <p className="mt-2 text-[11px] text-ok-text">{result.ok}</p>}
        {result?.error && <p className="mt-2 text-[11px] text-red-400">{result.error}</p>}
      </Popover>
  );
}
