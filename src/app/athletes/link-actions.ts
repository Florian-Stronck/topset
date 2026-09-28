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

/** The athlete's own check-in link, or the read-only Tracking link for a second coach. */
export type LinkKind = "athlete" | "viewer";

const COLUMN = { athlete: "accessToken", viewer: "viewToken" } as const;
const PATH = { athlete: "/a/", viewer: "/a/view/" } as const;

async function linkFor(token: string | null, kind: LinkKind): Promise<AthleteLink> {
  const settings = await loadSettings();
  const configured = settings.athleteAppUrl.trim().replace(/\/+$/, "");
  let origin = configured;
  if (!origin) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1";
    origin = `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
  }
  if (!token) return { url: null, svg: null, local: !configured };

  const url = `${origin}${PATH[kind]}${token}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { url, svg, local: !configured };
}

/** The athlete's current link, if they have one. */
export async function athleteLink(athleteId: string, kind: LinkKind = "athlete"): Promise<AthleteLink> {
  assertCoach();
  const athlete = await prisma.athlete.findUniqueOrThrow({
    where: { id: athleteId },
    select: { accessToken: true, viewToken: true },
  });
  return linkFor(athlete[COLUMN[kind]], kind);
}

/** A fresh link. Any link handed out before stops working. */
export async function createAccessLink(athleteId: string, kind: LinkKind = "athlete"): Promise<AthleteLink> {
  assertCoach();
  const token = crypto.randomBytes(24).toString("base64url");
  await prisma.athlete.update({ where: { id: athleteId }, data: { [COLUMN[kind]]: token } });
  revalidatePath("/athletes");
  revalidatePath("/tracking");
  return linkFor(token, kind);
}

export async function revokeAccessLink(athleteId: string, kind: LinkKind = "athlete"): Promise<AthleteLink> {
  assertCoach();
  await prisma.athlete.update({ where: { id: athleteId }, data: { [COLUMN[kind]]: null } });
  revalidatePath("/athletes");
  revalidatePath("/tracking");
  return linkFor(null, kind);
}
