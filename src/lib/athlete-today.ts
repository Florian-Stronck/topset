import { cookies } from "next/headers";
import { TZ_COOKIE } from "@/lib/athlete-cookies";

/**
 * Today as `YYYY-MM-DD` on the athlete's phone. The hosted server runs on UTC, which is
 * the wrong day for part of every evening in Europe; the phone's zone comes in a cookie.
 */
export async function athleteToday(): Promise<string> {
  const tz = (await cookies()).get(TZ_COOKIE)?.value;
  try {
    if (tz) return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  } catch {}
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
