import { NextResponse, type NextRequest } from "next/server";
import { isAthleteHost } from "@/lib/role";

/**
 * On the hosted athlete app only the athlete pages exist; every coach screen and API
 * route answers 404. (Server actions are guarded one by one with `assertCoach`, since
 * they can be called from any page.) The desktop app passes everything through.
 */
export function proxy(request: NextRequest) {
  if (!isAthleteHost()) return NextResponse.next();

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
