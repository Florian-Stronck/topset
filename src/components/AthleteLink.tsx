"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  athleteLink,
  createAccessLink,
  revokeAccessLink,
  type AthleteLink as LinkData,
} from "@/app/athletes/link-actions";
import { Popover } from "@/components/Popover";
import { t } from "@/lib/i18n";

/**
 * The athlete's check-in link: a QR code to scan off the screen, the address to send, and
 * a way to cut off a link that got out.
 */
export function AthleteLinkButton({
  athleteId,
  name,
  hasLink,
  initiallyOpen = false,
}: {
  athleteId: string;
  name: string;
  hasLink: boolean;
  initiallyOpen?: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(initiallyOpen);
  const [link, setLink] = useState<LinkData | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function load(action: () => Promise<LinkData>) {
    startTransition(async () => setLink(await action()));
  }

  // Opened from the palette: fetch once on arrival, the way a click would.
  useEffect(() => {
    if (!initiallyOpen) return;
    startTransition(async () => setLink(await athleteLink(athleteId)));
  }, [initiallyOpen, athleteId]);

  function toggle() {
    const next = !open;
    setOpen(next);
    setCopied(false);
    if (next) load(() => athleteLink(athleteId));
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={toggle}
        title={t("The link {name} checks in with", { name })}
        className={`rounded-lg border px-3 py-1.5 text-[12px] hover:border-accent hover:text-accent ${
          hasLink ? "border-border text-muted" : "border-dashed border-border text-muted-2"
        }`}
      >
        {t("Athlete link")}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={300}>
        <div className="text-[13px] font-semibold">{t("Check-in link for {name}", { name })}</div>
        <p className="mt-1 text-[11px] text-muted">
          {t("They open it on their phone to see their training and log every set. You see it here.")}
        </p>

        {!link ? (
          <div className="py-6 text-center text-[12px] text-muted-2">{t("Loading…")}</div>
        ) : link.url && link.svg ? (
          <>
            <div
              className="mx-auto mt-3 w-[200px] rounded-lg bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
              // The SVG is generated on our own server from our own URL.
              dangerouslySetInnerHTML={{ __html: link.svg }}
            />
            <div className="mt-3 flex items-center gap-1">
              <input
                readOnly
                value={link.url}
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
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                disabled={pending}
                onClick={() => load(() => createAccessLink(athleteId))}
                title={t("The old link stops working.")}
                className="text-[11px] text-muted hover:text-foreground disabled:opacity-50"
              >
                {t("New link")}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => load(() => revokeAccessLink(athleteId))}
                className="text-[11px] text-muted-2 hover:text-accent disabled:opacity-50"
              >
                {t("Turn off")}
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => load(() => createAccessLink(athleteId))}
            className="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white disabled:opacity-60"
          >
            {t("Create link")}
          </button>
        )}

        {link?.local && (
          <p className="mt-3 rounded border border-border bg-surface px-2 py-1.5 text-[11px] text-muted">
            {t("This link only works on this computer until the athlete app is online.")}{" "}
            <Link href="/settings#athlete-app" className="text-accent">
              {t("Set it up in Settings")}
            </Link>
          </p>
        )}
      </Popover>
    </>
  );
}
