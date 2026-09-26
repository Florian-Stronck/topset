import de from "@/lib/i18n/de";
import fr from "@/lib/i18n/fr";
import lb from "@/lib/i18n/lb";
import { activeSettings, type Language } from "@/lib/settings";

const DICTS: Record<Exclude<Language, "en">, Record<string, string>> = { de, fr, lb };

export const LANGUAGES: { id: Language; name: string }[] = [
  { id: "en", name: "English" },
  { id: "de", name: "Deutsch" },
  { id: "fr", name: "Français" },
  { id: "lb", name: "Lëtzebuergesch" },
];

/** The browser locale for each language, for dates spelled out in full. */
export const LOCALE: Record<Language, string> = { en: "en-GB", de: "de-DE", fr: "fr-FR", lb: "lb-LU" };

/** "{n} week" or "{n} weeks", translated. */
export function plural(n: number, one: string, many: string): string {
  return t(n === 1 ? one : many, { n });
}

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A weekday's short name (0 = Monday) in the coach's language. */
export function weekdayShort(index: number): string {
  return t(WEEKDAY_SHORT[index]);
}

/**
 * The text in the coach's language. Keys are the English text itself, so an untranslated
 * string still reads fine; `{name}` placeholders are filled from `vars`.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  return tIn(activeSettings().language, text, vars);
}

/** `t` in a language named outright, for text written outside any page (a push notification). */
export function tIn(lang: Language, text: string, vars?: Record<string, string | number>): string {
  const out = lang === "en" ? text : (DICTS[lang][text] ?? text);
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
