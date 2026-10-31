"use client";

import { usePathname } from "next/navigation";
import { useActionState } from "react";
import { signIn } from "@/app/a/coach/actions";
import { t } from "@/lib/i18n";

/** Username and password, as on the desktop app's Settings; back to the page asked for after. */
export function SignIn() {
  const next = usePathname();
  const [error, action, pending] = useActionState(signIn, null);

  return (
    <form action={action} className="mx-auto mt-16 flex max-w-[340px] flex-col gap-3">
      <h1 className="text-[22px] font-semibold tracking-tight">{t("Topset Coach")}</h1>
      <p className="text-[13px] text-muted">{t("Sign in with your Topset account to review, write and chat from your phone.")}</p>
      <input type="hidden" name="next" value={next} />
      <input
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        required
        placeholder={t("Username")}
        aria-label={t("Username")}
        className="h-11 rounded-xl border border-border bg-surface px-3 text-[15px] outline-none focus:border-accent"
      />
      <input
        name="password"
        type="password"
        autoComplete="current-password"
        required
        placeholder={t("Password")}
        aria-label={t("Password")}
        className="h-11 rounded-xl border border-border bg-surface px-3 text-[15px] outline-none focus:border-accent"
      />
      <button type="submit" disabled={pending} className="h-11 rounded-xl bg-accent text-[15px] font-medium text-white disabled:opacity-60">
        {t("Sign in")}
      </button>
      {error && <p className="text-[13px] text-miss">{t(error)}</p>}
    </form>
  );
}
