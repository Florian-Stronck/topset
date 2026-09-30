import { NextResponse, type NextRequest } from "next/server";
import { isAthleteHost } from "@/lib/role";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** `host` or `host:port`, without the port. */
const hostname = (host: string) => host.replace(/:\d+$/, "").toLowerCase();

/**
 * The coach side has no login, so only the coach's own window may talk to it. A request
 * addressed to any other name is a web page that rebound its own domain to 127.0.0.1 to
 * read the local server; a request sent from another site is a page trying to write to it
 * (a backup restore, say). Both are refused.
 */
export function localRequest(headers: Headers): boolean {
  if (!LOCAL_HOSTS.has(hostname(headers.get("host") ?? ""))) return false;
  const site = headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;
  // Browsers without Sec-Fetch-Site still send Origin on a write; "null" is a sandboxed page.
  const origin = headers.get("origin");
  return origin === null || URL.parse(origin)?.host.toLowerCase() === headers.get("host")?.toLowerCase();
}

/**
 * On the hosted athlete app only the athlete pages exist; every coach screen and API
 * route answers 404. (Server actions are guarded one by one with `assertCoach`, since
 * they can be called from any page.) The desktop app answers only its own window.
 */
export function proxy(request: NextRequest) {
  if (!isAthleteHost()) {
    return localRequest(request.headers) ? NextResponse.next() : new NextResponse(null, { status: 403 });
  }

  const path = request.nextUrl.pathname;
  if (path === "/a" || path.startsWith("/a/")) return NextResponse.next();
  // Where coaches' desktop apps sign in and sync.
  if (path.startsWith("/api/coach/")) return NextResponse.next();
  // The daily notifications, called by Vercel Cron with the server's CRON_SECRET.
  if (path.startsWith("/api/cron/")) return NextResponse.next();
  if (path === "/") return NextResponse.redirect(new URL("/a", request.url));
  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest).*)"],
};
