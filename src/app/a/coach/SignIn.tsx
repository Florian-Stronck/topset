"use client";

import { usePathname } from "next/navigation";
import { useActionState, useState } from "react";
import { resetPassword, signIn } from "@/app/a/coach/actions";
import { t } from "@/lib/i18n";

// The server's MIN_PASSWORD; `auth.ts` is server-only, so the number is written out here.
const MIN_PASSWORD = 8;

const input = "h-11 rounded-xl border border-border bg-surface px-3 text-[15px] outline-none focus:border-accent";
const primary = "h-11 rounded-xl bg-accent text-[15px] font-medium text-white disabled:opacity-60";

/** Username and password, or — behind "Forgot password?" — a reset code and a new password. */
export function SignIn() {
  const next = usePathname();
  const [forgot, setForgot] = useState(false);
  const [error, action, pending] = useActionState(signIn, null);
  const [resetError, resetAction, resetting] = useActionState(resetPassword, null);

  if (forgot) {
    return (
      <form action={resetAction} className="mx-auto mt-16 flex max-w-[340px] flex-col gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">{t("Forgot password?")}</h1>
        <p className="text-[13px] text-muted">
          {t("Ask your admin for a reset code. If you're the admin, it's the server's setup code, kept in the hosting settings.")}
        </p>
        <input type="hidden" name="next" value={next} />
        <input name="username" defaultValue={resetError?.username} autoComplete="username" autoCapitalize="none" placeholder={t("Username (admin: leave empty)")} aria-label={t("Username")} className={input} />
        <input name="code" defaultValue={resetError?.code} autoComplete="one-time-code" autoCapitalize="characters" required placeholder={t("Reset code")} aria-label={t("Reset code")} className={input} />
        <input name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} placeholder={t("New password")} aria-label={t("New password")} className={input} />
        <input name="again" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} placeholder={t("Repeat the new password")} aria-label={t("Repeat the new password")} className={input} />
        <button type="submit" disabled={resetting} className={primary}>
          {t("Set new password")}
        </button>
        {resetError && <p className="text-[13px] text-miss">{t(resetError.error)}</p>}
        <button type="button" onClick={() => setForgot(false)} className="h-11 text-[14px] text-muted">
          {t("Back to sign in")}
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="mx-auto mt-16 flex max-w-[340px] flex-col gap-3">
      <h1 className="text-[22px] font-semibold tracking-tight">{t("Topset Coach")}</h1>
      <p className="text-[13px] text-muted">{t("Sign in with your Topset account to review, write and chat from your phone.")}</p>
      <input type="hidden" name="next" value={next} />
      <input name="username" defaultValue={error?.username} autoComplete="username" autoCapitalize="none" required placeholder={t("Username")} aria-label={t("Username")} className={input} />
      <input name="password" type="password" autoComplete="current-password" required placeholder={t("Password")} aria-label={t("Password")} className={input} />
      <button type="submit" disabled={pending} className={primary}>
        {t("Sign in")}
      </button>
      {error && <p className="text-[13px] text-miss">{t(error.error)}</p>}
      <button type="button" onClick={() => setForgot(true)} className="h-11 text-[14px] text-muted">
        {t("Forgot password?")}
      </button>
    </form>
  );
}
