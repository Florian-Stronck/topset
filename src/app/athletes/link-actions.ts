"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { loadSettings } from "@/lib/coach-settings";
import { prisma } from "@/lib/prisma";
import { assertCoach } from "@/lib/role";

export type AthleteLink = {
  url: string | null;
  /** The QR code for `url`, as an SVG document. */
  svg: string | null;
  /**
   * No athlete-app address is set in Settings, so the link points at this computer —
   * fine for trying it out, but a phone elsewhere can't open it.
   */
  local: boolean;
};

/**
 * The athlete's own check-in link, or the coach's way to the athlete on their own phone:
 * the server's `/a/coach` pages, behind the coach's sign-in, so it needs no secret.
 */
export type LinkKind = "athlete" | "phone";

async function linkFor(path: string | null): Promise<AthleteLink> {
  const settings = await loadSettings();
  const configured = settings.athleteAppUrl.trim().replace(/\/+$/, "");
  let origin = configured;
  if (!origin) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1";
    origin = `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
  }
  if (!path) return { url: null, svg: null, local: !configured };

  const url = `${origin}${path}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { url, svg, local: !configured };
}

/** The athlete's current link, if they have one. */
export async function athleteLink(athleteId: string, kind: LinkKind = "athlete"): Promise<AthleteLink> {
  assertCoach();
  if (kind === "phone") return linkFor(`/a/coach/${athleteId}`);
  const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: athleteId }, select: { accessToken: true } });
  return linkFor(athlete.accessToken && `/a/${athlete.accessToken}`);
}

/** A fresh link. Any link handed out before stops working. */
export async function createAccessLink(athleteId: string): Promise<AthleteLink> {
  assertCoach();
  const token = crypto.randomBytes(24).toString("base64url");
  await prisma.athlete.update({ where: { id: athleteId }, data: { accessToken: token } });
  revalidatePath("/athletes");
  revalidatePath("/tracking");
  return linkFor(`/a/${token}`);
}

export async function revokeAccessLink(athleteId: string): Promise<AthleteLink> {
  assertCoach();
  await prisma.athlete.update({ where: { id: athleteId }, data: { accessToken: null } });
  revalidatePath("/athletes");
  revalidatePath("/tracking");
  return linkFor(null);
}
