"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";

/**
 * A text trigger that swaps itself for a question and a Delete/Cancel pair. While the
 * question is up, Delete or Enter answers yes and Escape backs out.
 */
export function Confirm({
  label,
  question,
  onConfirm,
  className = "",
  initiallyConfirming = false,
}: {
  label: string;
  question: string;
  onConfirm: () => Promise<void>;
  className?: string;
  /** Skip the label button and open straight to the question — for triggers (like an × icon) that already signal intent. */
  initiallyConfirming?: boolean;
}) {
  const [confirming, setConfirming] = useState(initiallyConfirming);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    await onConfirm();
  }

  // The listener outlives renders, so it reads the latest confirm through a ref.
  const confirmRef = useRef(confirm);
  useEffect(() => {
    confirmRef.current = confirm;
  });

  useEffect(() => {
    if (!confirming || pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        void confirmRef.current();
      } else if (e.key === "Escape") {
        setConfirming(false);
      }
    }
    // Capture, so a focused grid cell doesn't also take the key.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [confirming, pending]);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`text-[11px] text-muted-2 hover:text-accent ${className}`}
      >
        {t(label)}
      </button>
    );
  }

  return (
    <div className="flex w-full items-center gap-2">
      <span className="text-[11px] text-muted">{question}</span>
      <button
        type="button"
        disabled={pending}
        onClick={confirm}
        title={t("Delete or Enter")}
        className="ml-auto rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-60"
      >
        {pending ? "…" : t("Delete")}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-[11px] text-muted-2 hover:text-foreground"
      >
        {t("Cancel")}
      </button>
    </div>
  );
}
