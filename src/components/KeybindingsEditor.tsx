"use client";

import { useMemo, useState } from "react";
import { useKeyRecorder } from "@/components/useKeyRecorder";
import { resetPref, setPref, usePref } from "@/lib/prefs";
import {
  bindKey,
  clashes,
  COMMAND_SPECS,
  defaultKeys,
  keysOf,
  label,
  overridesNative,
  setKeys,
  SPEC_BY_ID,
} from "@/lib/shortcuts";
import { t } from "@/lib/i18n";

type Entry = { id: string; title: string; group: string; grid: boolean };

/**
 * Every command and its keys, like an editor's keybindings screen: search by name or by
 * pressing the keys, add or remove keys, put a command back to its defaults, or edit the
 * whole set as JSON.
 */
export function KeybindingsEditor() {
  const overrides = usePref("keybindings");
  const titles = usePref("keybindingTitles");
  const pinned = usePref("pinnedCommands");
  const recorder = useKeyRecorder();
  const [query, setQuery] = useState("");
  const [byKeys, setByKeys] = useState<string | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [json, setJson] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const entries = useMemo<Entry[]>(() => {
    const built = COMMAND_SPECS.map((s) => ({ id: s.id, title: t(s.title), group: s.group, grid: s.when === "grid" }));
    const extra = Object.keys({ ...overrides, ...titles })
      .filter((id) => !SPEC_BY_ID.has(id))
      .map((id) => ({ id, title: titles[id] ?? id, group: "Other", grid: false }));
    return [...built, ...extra];
  }, [overrides, titles]);

  const titleOf = (id: string) => entries.find((e) => e.id === id)?.title ?? id;

  const shown = entries.filter((e) => {
    const keys = keysOf(e.id, overrides);
    if (onlyChanged && !(e.id in overrides)) return false;
    if (byKeys) return keys.some((k) => k === byKeys || k.startsWith(`${byKeys} `));
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const hay = `${e.title} ${t(e.group)} ${e.id} ${keys.map(label).join(" ")}`.toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });

  const changed = Object.keys(overrides).length;

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={byKeys ? label(byKeys) : query}
          readOnly={byKeys !== null}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search commands or keys…")}
          className="min-w-[200px] flex-1 rounded border border-border bg-transparent px-2 py-1 text-[12px] outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() =>
            byKeys !== null || recorder.target === "__search"
              ? (recorder.cancel(), setByKeys(null))
              : recorder.start("__search", (keys) => setByKeys(keys))
          }
          className={`rounded border px-2 py-1 text-[12px] ${
            byKeys !== null || recorder.target === "__search" ? "border-accent text-accent" : "border-border text-muted hover:text-accent"
          }`}
          title={t("Press keys to find what they do")}
        >
          {recorder.target === "__search" ? t("Press keys…") : byKeys ? t("Clear") : t("Search by keys")}
        </button>
        <label className="flex items-center gap-1 text-[12px] text-muted">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          {t("Changed only")} ({changed})
        </label>
      </div>

      <table className="mt-3 w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10px] tracking-[0.14em] text-muted-2">
            <th className="pb-1 font-normal">{t("COMMAND")}</th>
            <th className="pb-1 font-normal">{t("KEYS")}</th>
            <th className="pb-1 font-normal" />
          </tr>
        </thead>
        <tbody>
          {shown.map((e, i) => {
            const keys = keysOf(e.id, overrides);
            const custom = e.id in overrides;
            const warnings = keys.flatMap((k) => {
              const others = clashes(e.id, k, overrides);
              const out: string[] = [];
              if (others.length) out.push(t("{keys} is also {names}", { keys: label(k), names: others.map(titleOf).join(", ") }));
              if (overridesNative(k)) out.push(t("{keys} replaces the browser's own", { keys: label(k) }));
              return out;
            });
            const newGroup = i === 0 || shown[i - 1].group !== e.group;
            return [
              newGroup && (
                <tr key={`g-${e.group}`}>
                  <td colSpan={3} className="pt-3 pb-1 text-[10px] tracking-[0.16em] text-muted-2">
                    {t(e.group).toUpperCase()}
                  </td>
                </tr>
              ),
              <tr key={e.id} className="border-t border-border align-top">
                <td className="py-1.5 pr-3">
                  <div className={custom ? "text-foreground" : "text-muted"}>
                    {e.title}
                    {pinned.includes(e.id) && <span className="ml-1 text-accent">★</span>}
                  </div>
                  <div className="text-[10px] text-muted-2">
                    {e.id}
                    {e.grid && ` · ${t("with a row focused")}`}
                  </div>
                  {warnings.map((w) => (
                    <div key={w} className="text-[11px] text-warn">
                      {w}
                    </div>
                  ))}
                </td>
                <td className="py-1.5 pr-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {keys.map((k) => (
                      <span key={k} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                        {label(k)}
                        <button
                          type="button"
                          title={t("Remove")}
                          onClick={() => setKeys(e.id, keys.filter((x) => x !== k), e.title)}
                          className="text-muted-2 hover:text-accent"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {recorder.target === e.id ? (
                      <span className="rounded border border-accent px-1.5 py-0.5 text-[11px] text-accent">
                        {recorder.strokes.length ? `${label(recorder.strokes.join(" "))} …` : t("Press keys…")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => recorder.start(e.id, (k) => bindKey(e.id, k, e.title))}
                        className="rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-2 hover:border-accent hover:text-accent"
                      >
                        {keys.length ? "+" : t("+ Add key")}
                      </button>
                    )}
                  </div>
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  {custom && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...overrides };
                        delete next[e.id];
                        setPref("keybindings", next);
                      }}
                      title={defaultKeys(e.id).length ? defaultKeys(e.id).map(label).join(", ") : t("No key")}
                      className="text-[11px] text-muted-2 hover:text-accent"
                    >
                      {t("Reset")}
                    </button>
                  )}
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      {shown.length === 0 && <div className="py-4 text-center text-[12px] text-muted-2">{t("Nothing matches.")}</div>}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-[12px]">
        <button
          type="button"
          onClick={() => {
            setJson(JSON.stringify(overrides, null, 2));
            setJsonError(null);
          }}
          className="text-muted hover:text-accent"
        >
          {t("Edit as JSON")}
        </button>
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([JSON.stringify(overrides, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "topset-keybindings.json";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
          className="text-muted hover:text-accent"
        >
          {t("Export")}
        </button>
        {changed > 0 && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t("Put every shortcut back to its default?"))) {
                resetPref("keybindings");
                resetPref("keybindingTitles");
              }
            }}
            className="ml-auto text-muted-2 hover:text-accent"
          >
            {t("Reset all shortcuts")}
          </button>
        )}
      </div>

      {json !== null && (
        <div className="mt-3">
          <p className="text-[11px] text-muted-2">
            {t("Command id → list of keys. An empty list switches a command's keys off; a chord is two strokes with a space: \"mod+k mod+s\".")}
          </p>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            rows={10}
            className="mt-1 w-full rounded border border-border bg-transparent p-2 font-mono text-[12px] outline-none focus:border-accent"
          />
          {jsonError && <div className="text-[11px] text-warn">{jsonError}</div>}
          <div className="mt-1 flex gap-3 text-[12px]">
            <button
              type="button"
              onClick={() => {
                try {
                  const parsed = JSON.parse(json) as unknown;
                  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
                  const next: Record<string, string[]> = {};
                  for (const [id, keys] of Object.entries(parsed)) {
                    const list = typeof keys === "string" ? [keys] : keys;
                    if (!Array.isArray(list) || !list.every((k) => typeof k === "string")) throw new Error();
                    next[id] = list.map((k: string) => k.trim().toLowerCase()).filter(Boolean);
                  }
                  setPref("keybindings", next);
                  setJson(null);
                } catch {
                  setJsonError(t("That isn't a list of command ids and keys."));
                }
              }}
              className="text-accent hover:underline"
            >
              {t("Apply")}
            </button>
            <button type="button" onClick={() => setJson(null)} className="text-muted-2 hover:text-foreground">
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
