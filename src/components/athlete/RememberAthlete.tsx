"use client";

import { useEffect } from "react";
import { ATHLETE_COOKIE, TZ_COOKIE } from "@/lib/athlete-cookies";

/**
 * Remembers whose page this phone opened, so the home-screen icon lands on it, and the
 * phone's time zone, so "today" on the server is the athlete's today.
 */
export function RememberAthlete({ token }: { token: string }) {
  useEffect(() => {
    const year = 60 * 60 * 24 * 365;
    document.cookie = `${ATHLETE_COOKIE}=${encodeURIComponent(token)}; path=/a; max-age=${year}; samesite=lax`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/a; max-age=${year}; samesite=lax`;
  }, [token]);
  return null;
}
