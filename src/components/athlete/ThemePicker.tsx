"use client";

import { setPref, usePref, type Prefs } from "@/lib/prefs";
import { t } from "@/lib/i18n";

const CHOICES: { id: Prefs["theme"]; label: string; icon: string }[] = [
  { id: "system", label: "Auto", icon: "M12 3a9 9 0 1 0 0 18V3Z M12 3a9 9 0 0 1 0 18" },
  { id: "light", label: "Light", icon: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" },
  { id: "dark", label: "Dark", icon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" },
];

/** Light, dark, or whatever the phone is set to; kept on this phone. */
export function ThemePicker() {
  const theme = usePref("theme");
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="text-[15px] font-semibold">{t("Appearance")}</h2>
      <p className="mt-0.5 text-[12px] text-muted">{t("Auto follows your phone's light or dark setting.")}</p>
      <div role="radiogroup" aria-label={t("Appearance")} className="mt-3 grid grid-cols-3 gap-1 rounded-2xl border border-border bg-background p-1">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={theme === c.id}
            onClick={() => setPref("theme", c.id)}
            className={`flex h-11 items-center justify-center gap-1.5 rounded-xl text-[14px] ${
              theme === c.id ? "bg-surface-3 font-medium text-foreground" : "text-muted"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={c.icon} />
            </svg>
            {t(c.label)}
          </button>
        ))}
      </div>
    </section>
  );
}
