/**
 * The athlete app's service worker: shows the coach's notes as notifications while the app
 * is closed, badges the home-screen icon with what's unread, and opens the inbox on a tap.
 * Served from /a/ so it covers every athlete page and nothing of the coach's.
 */
const WORKER = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {}
  const shown = self.registration.showNotification(data.title || "Topset", {
    body: data.body || "",
    tag: data.tag,
    icon: "/favicon.ico",
    data: { url: data.url || "/a" },
  });
  const badge =
    typeof data.badge === "number" && self.navigator.setAppBadge
      ? self.navigator.setAppBadge(data.badge).catch(() => {})
      : null;
  event.waitUntil(Promise.all([shown, badge]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/a", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (open) => {
      for (const client of open) {
        if (!client.url.startsWith(self.location.origin + "/a")) continue;
        const moved = client.navigate ? await client.navigate(url).catch(() => null) : null;
        return (moved || client).focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
`;

export function GET() {
  return new Response(WORKER, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/a/",
    },
  });
}
