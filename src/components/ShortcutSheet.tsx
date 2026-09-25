"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { usePref } from "@/lib/prefs";
import { COMMAND_SPECS, FIXED_GROUPS, keysOf, label, SPEC_BY_ID } from "@/lib/shortcuts";
import { t } from "@/lib/i18n";

type Item = { key: string; keys: string[]; what: string };

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Read so the sheet redraws when a binding changes.
  const overrides = usePref("keybindings");
  const titles = usePref("keybindingTitles");
  if (!open || typeof document === "undefined") return null;

  // Every command with a key, grouped the way the palette groups them.
  const groups = new Map<string, Item[]>();
  const add = (group: string, item: Item) => groups.set(group, [...(groups.get(group) ?? []), item]);
  for (const spec of COMMAND_SPECS) {
    const keys = keysOf(spec.id, overrides);
    if (keys.length > 0) add(spec.group, { key: spec.id, keys, what: t(spec.title) });
  }
  for (const [id, keys] of Object.entries(overrides)) {
    if (!SPEC_BY_ID.has(id) && keys.length > 0) add("Other", { key: id, keys, what: titles[id] ?? id });
  }
  for (const g of FIXED_GROUPS) {
    for (const item of g.items) add(g.title, { key: item.combo, keys: [item.combo], what: t(item.what) });
  }

  return createPortal(
    <div
      data-overlay
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[80vh] w-[min(820px,94vw)] overflow-auto rounded-xl border border-border bg-surface-2 p-5 shadow-2xl shadow-black/60">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[15px] font-semibold">{t("Keyboard")}</h2>
          <Link href="/settings#keyboard" onClick={onClose} className="text-[11px] text-accent hover:underline">
            {t("Customise…")}
          </Link>
          <button type="button" onClick={onClose} className="ml-auto text-[11px] text-muted-2 hover:text-foreground">
            {t("Close")}
          </button>
        </div>

        <div className="mt-4 columns-1 gap-6 sm:columns-3">
          {[...groups].map(([group, items]) => (
            <div key={group} className="mb-5 break-inside-avoid">
              <div className="text-[10px] tracking-[0.16em] text-muted-2">{t(group).toUpperCase()}</div>
              <ul className="mt-2 space-y-1.5">
                {items.map((item) => (
                  <li key={item.key} className="flex items-center gap-2 text-[12px]">
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((k) => (
                        <span key={k} className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted">
                          {label(k)}
                        </span>
                      ))}
                    </span>
                    <span className="text-muted-2">{item.what}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
