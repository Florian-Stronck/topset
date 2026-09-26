import crypto from "node:crypto";

/**
 * Object storage for athlete videos: any S3-compatible bucket, meant for Cloudflare R2
 * (free up to 10 GB, and no charge for downloads). The server never handles a video
 * itself. It hands out short-lived signed links instead: the phone uploads straight to the
 * bucket, and the phone and the coach's desktop app play or download straight from it.
 * The signing is AWS Signature Version 4, done here with node:crypto.
 */

export type StorageConfig = {
  /** `https://<account id>.r2.cloudflarestorage.com` for R2. */
  endpoint: string;
  /** Empty when the endpoint already names the bucket (virtual-hosted style). */
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** The bucket from the server's environment, or null when videos aren't set up. */
export function storageConfig(env: Record<string, string | undefined> = process.env): StorageConfig | null {
  const account = env.TOPSET_R2_ACCOUNT_ID;
  const endpoint = env.TOPSET_VIDEO_ENDPOINT || (account ? `https://${account}.r2.cloudflarestorage.com` : "");
  const bucket = env.TOPSET_VIDEO_BUCKET ?? "";
  const accessKeyId = env.TOPSET_VIDEO_ACCESS_KEY_ID ?? "";
  const secretAccessKey = env.TOPSET_VIDEO_SECRET_ACCESS_KEY ?? "";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), bucket, region: env.TOPSET_VIDEO_REGION || "auto", accessKeyId, secretAccessKey };
}

/** RFC 3986 encoding, as SigV4 wants it: everything but A–Z a–z 0–9 - _ . ~ */
function encode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const hmac = (key: crypto.BinaryLike, text: string) => crypto.createHmac("sha256", key).update(text).digest();

/** `20130524T000000Z` */
function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type PresignOptions = {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  key: string;
  /** Seconds the link works for; SigV4 allows up to a week. */
  expiresIn: number;
  /**
   * Headers the request must carry exactly, and that are signed: an upload's
   * content-type and content-length, so the link can't be used for anything else.
   */
  headers?: Record<string, string>;
  /** Extra query parameters, signed too (`response-content-disposition`, say). */
  query?: Record<string, string>;
  now?: Date;
};

/** A link that performs one request on one object, for a while, with no other credentials. */
export function presign(config: StorageConfig, { method, key, expiresIn, headers = {}, query = {}, now = new Date() }: PresignOptions): string {
  const base = new URL(config.endpoint);
  const path = `${base.pathname.replace(/\/+$/, "")}${config.bucket ? `/${encode(config.bucket)}` : ""}/${key.split("/").map(encode).join("/")}`;
  const stamp = amzDate(now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${config.region}/s3/aws4_request`;

  const signed: Record<string, string> = { host: base.host };
  for (const [name, value] of Object.entries(headers)) signed[name.toLowerCase()] = value.trim();
  const names = Object.keys(signed).sort();

  const params: Record<string, string> = {
    ...query,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(Math.max(1, Math.min(604800, Math.round(expiresIn)))),
    "X-Amz-SignedHeaders": names.join(";"),
  };
  const canonicalQuery = Object.keys(params)
    .map((k) => [encode(k), encode(params[k])] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    names.map((n) => `${n}:${signed[n]}\n`).join(""),
    names.join(";"),
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonicalRequest)].join("\n");

  const key4 = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date), config.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", key4).update(stringToSign).digest("hex");

  return `${base.protocol}//${base.host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** The size of an object in the bucket, or null if it isn't there. */
export async function objectSize(config: StorageConfig, key: string): Promise<number | null> {
  const res = await fetch(presign(config, { method: "HEAD", key, expiresIn: 60 }), { method: "HEAD", cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storage answered ${res.status}.`);
  const length = Number(res.headers.get("content-length"));
  return Number.isFinite(length) ? length : null;
}

/** Deletes an object; one that is already gone is fine. */
export async function deleteObject(config: StorageConfig, key: string): Promise<void> {
  const res = await fetch(presign(config, { method: "DELETE", key, expiresIn: 60 }), { method: "DELETE", cache: "no-store" });
  if (!res.ok && res.status !== 404) throw new Error(`Storage answered ${res.status}.`);
}
