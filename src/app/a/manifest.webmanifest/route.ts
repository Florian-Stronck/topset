/** Lets an athlete put their check-in page on the home screen like an app. */
export function GET() {
  return Response.json(
    {
      name: "Topset Check-in",
      short_name: "Topset",
      start_url: "/a",
      scope: "/a",
      display: "standalone",
      background_color: "#0a0a0c",
      theme_color: "#0a0a0c",
      icons: [{ src: "/favicon.ico", sizes: "256x256", type: "image/x-icon" }],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
