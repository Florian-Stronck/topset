"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { AthleteLink as LinkData, LinkKind } from "@/app/athletes/link-actions";
import { useCoachActions } from "@/components/CoachActions";
import { Popover } from "@/components/Popover";
import { t } from "@/lib/i18n";

/** The link fetched on arrival, and the calls that replace or end it. */
function useLink(athleteId: string, kind: LinkKind, fetchNow: boolean) {
  const { athleteLink, createAccessLink, revokeAccessLink } = useCoachActions();
  const [link, setLink] = useState<LinkData | null>(null);
  const [pending, startTransition] = useTransition();
  const load = (action: () => Promise<LinkData>) => startTransition(async () => setLink(await action()));

  useEffect(() => {
    if (!fetchNow) return;
    startTransition(async () => setLink(await athleteLink(athleteId, kind)));
  }, [fetchNow, athleteId, kind, athleteLink]);

  return {
    link,
    pending,
    refetch: () => load(() => athleteLink(athleteId, kind)),
    // The phone link is the same for good: nothing to replace or end.
    tokens: kind === "athlete",
    create: () => load(() => createAccessLink(athleteId)),
    revoke: () => load(() => revokeAccessLink(athleteId)),
  };
}

/**
 * The QR code to scan off the screen, the address to send, and a way to cut off a link that
 * got out — in the popover, or laid out flat beside the code on the Athlete app tab.
 */
function LinkBody({ state, wide = false }: { state: ReturnType<typeof useLink>; wide?: boolean }) {
  const { link, pending, tokens, create, revoke } = state;
  // Settings are the desktop app's.
  const { phone } = useCoachActions();
  const [copied, setCopied] = useState(false);

  if (!link) return <div className="py-6 text-center text-[12px] text-muted-2">{t("Loading…")}</div>;

  const local = link.local && !phone && (
    <p className="mt-3 rounded border border-border bg-surface px-2 py-1.5 text-[11px] text-muted">
      {t("This link only works on this computer until the athlete app is online.")}{" "}
      <Link href="/settings#athlete-app" className="text-accent">
        {t("Set it up in Settings")}
      </Link>
    </p>
  );

  if (!link.url || !link.svg) {
    return (
      <>
        <button
          type="button"
          disabled={pending}
          onClick={create}
          className={`${wide ? "" : "mt-3 w-full"} rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white disabled:opacity-60`}
        >
          {t("Create link")}
        </button>
        {local}
      </>
    );
  }

  return (
    <div className={wide ? "flex flex-wrap items-start gap-4" : ""}>
      <div
        className={`${wide ? "w-[132px] shrink-0" : "mx-auto mt-3 w-[200px]"} rounded-lg bg-white p-2 [&>svg]:h-auto [&>svg]:w-full`}
        // The SVG is generated on our own server from our own URL.
        dangerouslySetInnerHTML={{ __html: link.svg }}
      />
      <div className={wide ? "flex min-w-0 flex-1 basis-[240px] flex-col gap-2.5" : ""}>
        <div className={`${wide ? "" : "mt-3"} flex items-center gap-1`}>
          <input
            readOnly
            value={link.url}
            aria-label={t("Link")}
            onFocus={(e) => e.currentTarget.select()}
            className="h-7 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-[11px] text-muted outline-none"
          />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(link.url!);
              setCopied(true);
            }}
            className="h-7 rounded bg-accent px-2 text-[11px] font-medium text-white"
          >
            {copied ? t("Copied") : t("Copy")}
          </button>
        </div>
        {tokens && (
          <div className={`${wide ? "" : "mt-3"} flex items-center justify-between gap-3`}>
            <button type="button" disabled={pending} onClick={create} title={t("The old link stops working.")} className="text-[11px] text-muted hover:text-foreground disabled:opacity-50">
              {t("New link")}
            </button>
            <button type="button" disabled={pending} onClick={revoke} className="text-[11px] text-muted-2 hover:text-accent disabled:opacity-50">
              {t("Turn off")}
            </button>
          </div>
        )}
        {local}
      </div>
    </div>
  );
}

/** The athlete's check-in link, laid out flat: fetched as soon as it's shown. */
export function AthleteLinkPanel({ athleteId, kind = "athlete" }: { athleteId: string; kind?: LinkKind }) {
  return <LinkBody state={useLink(athleteId, kind, true)} wide />;
}

/**
 * The athlete's check-in link: a QR code to scan off the screen, the address to send, and
 * a way to cut off a link that got out.
 */
export function AthleteLinkButton({
  athleteId,
  name,
  hasLink,
  initiallyOpen = false,
  kind = "athlete",
}: {
  athleteId: string;
  name: string;
  hasLink: boolean;
  initiallyOpen?: boolean;
  /** "phone": this athlete on the coach's own phone, behind their Topset sign-in. */
  kind?: LinkKind;
}) {
  const phone = kind === "phone";
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(initiallyOpen);
  // Opened from the palette: fetch once on arrival, the way a click would.
  const state = useLink(athleteId, kind, initiallyOpen);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) state.refetch();
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={toggle}
        title={phone ? t("Open {name} on your phone", { name }) : t("The link {name} checks in with", { name })}
        className={`rounded-lg border px-3 py-1.5 text-[12px] hover:border-accent hover:text-accent ${
          hasLink ? "border-border text-muted" : "border-dashed border-border text-muted-2"
        }`}
      >
        {phone ? t("On your phone") : t("Athlete link")}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={300}>
        <div className="text-[13px] font-semibold">
          {phone ? t("{name} on your phone", { name }) : t("Check-in link for {name}", { name })}
        </div>
        <p className="mt-1 text-[11px] text-muted">
          {phone
            ? t("Scan it and sign in with your Topset account: review, notes, weigh-ins and the chat, as here.")
            : t("They open it on their phone to see their training and log every set. You see it here.")}
        </p>
        {open && <LinkBody state={state} />}
      </Popover>
    </>
  );
}
