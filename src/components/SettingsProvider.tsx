"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { updateSettings } from "@/app/settings/actions";
import { usePref } from "@/lib/prefs";
import { mergeSettings, setActiveSettings, type CoachSettings, type SettingsPatch } from "@/lib/settings";

type Ctx = {
  settings: CoachSettings;
  update: (patch: SettingsPatch) => void;
  saving: boolean;
};

const SettingsContext = createContext<Ctx | null>(null);

/**
 * Hands the coach's settings to every client component, and applies a change on screen
 * straight away while the server stores it.
 */
export function SettingsProvider({
  settings: fromServer,
  children,
}: {
  settings: CoachSettings;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [saving, startTransition] = useTransition();
  const [local, setLocal] = useState<CoachSettings | null>(null);

  // A fresh server copy supersedes whatever was shown optimistically.
  const [seen, setSeen] = useState(fromServer);
  if (seen !== fromServer) {
    setSeen(fromServer);
    setLocal(null);
  }

  const settings = local ?? fromServer;
  setActiveSettings(settings);

  function update(patch: SettingsPatch) {
    setLocal(mergeSettings(settings, patch));
    startTransition(async () => {
      await updateSettings(patch);
      router.refresh();
    });
  }

  return (
    <SettingsContext.Provider value={{ settings, update, saving }}>
      <ThemeSync />
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}

const ZOOM = { small: "0.9", medium: "1", large: "1.12" } as const;

/** The per-computer look — theme, accent, text size — written onto <html>. */
function ThemeSync() {
  const theme = usePref("theme");
  const accent = usePref("accent");
  const fontSize = usePref("fontSize");
  const density = usePref("density");

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-soft", `${accent}22`);
    document.body.style.zoom = ZOOM[fontSize];
  }, [theme, accent, fontSize, density]);

  return null;
}
