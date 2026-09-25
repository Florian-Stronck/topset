import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadSettings } from "@/lib/coach-settings";
import { LAST_SCREEN_COOKIE } from "@/lib/athlete-cookies";

export const dynamic = "force-dynamic";

/** Opens the screen the coach picked in Settings — or, for "last", wherever they left off. */
export default async function Home() {
  const { startScreen } = await loadSettings();
  if (startScreen === "overview") redirect("/overview");
  if (startScreen === "last") {
    const raw = (await cookies()).get(LAST_SCREEN_COOKIE)?.value ?? "";
    let last = raw;
    try {
      last = decodeURIComponent(raw);
    } catch {}
    // Only ever a path inside the app, never somewhere else.
    if (last && last.startsWith("/") && !last.startsWith("//")) redirect(last);
  }
  redirect("/programming");
}
