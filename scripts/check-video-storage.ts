// Checks the video bucket the way the athlete app uses it, from this computer:
//
//   npx tsx scripts/check-video-storage.ts https://topset-yourname.vercel.app
//
// It reads the same TOPSET_* variables as the server (from the environment or .env),
// uploads a tiny test file through a signed link exactly like a phone does, reads it
// back, deletes it, and asks the bucket whether it lets the athlete site upload (CORS).
// The keys stay on this computer; only signed links go to the bucket.
import "dotenv/config";
import crypto from "node:crypto";
import { presign, storageConfig } from "../src/lib/storage";

const origin = (process.argv[2] ?? "").replace(/\/+$/, "");
const config = storageConfig();

function explain(code: string): string {
  const hints: Record<string, string> = {
    InvalidAccessKeyId: "The access key id is wrong, or the token was deleted.",
    SignatureDoesNotMatch: "The secret access key doesn't belong to that access key id.",
    NoSuchBucket: "No bucket by that name in this account. Check TOPSET_VIDEO_BUCKET and the account id.",
    AccessDenied: "The token can't write to this bucket. Give it Object Read & Write on it.",
    Unauthorized: "The token can't write to this bucket. Give it Object Read & Write on it.",
  };
  return hints[code] ?? "";
}

async function step(name: string, run: () => Promise<Response>): Promise<Response | null> {
  try {
    const res = await run();
    const body = res.ok ? "" : await res.text();
    const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? "";
    console.log(`${res.ok ? "OK  " : "FAIL"} ${name}: ${res.status}${code ? ` ${code}` : ""}${code && explain(code) ? `\n     ${explain(code)}` : ""}`);
    return res;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code ?? (error as Error).message;
    console.log(`FAIL ${name}: couldn't reach ${config?.endpoint} (${cause})`);
    if (cause === "ENOTFOUND") console.log("     That address doesn't exist: the account id is wrong (or the bucket is in the EU jurisdiction: set TOPSET_VIDEO_ENDPOINT to https://<id>.eu.r2.cloudflarestorage.com).");
    return null;
  }
}

(async () => {
  if (!config) {
    console.log("Videos aren't set up: set TOPSET_R2_ACCOUNT_ID (or TOPSET_VIDEO_ENDPOINT), TOPSET_VIDEO_BUCKET,");
    console.log("TOPSET_VIDEO_ACCESS_KEY_ID and TOPSET_VIDEO_SECRET_ACCESS_KEY, in this window or in .env.");
    process.exit(1);
  }
  console.log(`Bucket "${config.bucket}" at ${config.endpoint}, key ${config.accessKeyId.slice(0, 4)}…${config.accessKeyId.slice(-4)}\n`);

  const key = `check/${crypto.randomUUID()}.mp4`;
  const body = new Uint8Array(1024);
  const headers = { "Content-Type": "video/mp4", "Content-Length": String(body.length) };

  const put = await step("upload through a signed link", () =>
    fetch(presign(config, { method: "PUT", key, expiresIn: 300, headers }), { method: "PUT", headers: { "Content-Type": "video/mp4" }, body }),
  );
  if (put?.ok) {
    await step("check it arrived", () => fetch(presign(config, { method: "HEAD", key, expiresIn: 60 }), { method: "HEAD" }));
    await step("play link", () => fetch(presign(config, { method: "GET", key, expiresIn: 60 })));
    await step("delete it", () => fetch(presign(config, { method: "DELETE", key, expiresIn: 60 }), { method: "DELETE" }));
  }

  if (!origin) {
    console.log("\nAdd your athlete site's address to check CORS too, e.g.:");
    console.log("  npx tsx scripts/check-video-storage.ts https://topset-yourname.vercel.app");
    return;
  }
  const res = await step(`CORS for ${origin}`, () =>
    fetch(presign(config, { method: "PUT", key, expiresIn: 60, headers }), {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
    }),
  );
  const allowed = res?.headers.get("access-control-allow-origin");
  if (res && allowed !== origin && allowed !== "*") {
    console.log(`     The bucket doesn't let ${origin} upload. In the bucket's CORS policy, AllowedOrigins must hold exactly`);
    console.log(`     "${origin}" (https, no trailing /), AllowedMethods GET, PUT and HEAD, and AllowedHeaders "content-type".`);
  } else if (res) {
    console.log(`     ${origin} may upload.`);
  }
})();
