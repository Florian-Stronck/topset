"use server";

import { assertCoach } from "@/lib/role";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { mergeSettings, parseSettings, setActiveSettings, type SettingsPatch } from "@/lib/settings";

/**
 * Stores only what the coach changed — anything left at its default keeps following the
 * default, so a better default in a later version still reaches them.
 */
export async function updateSettings(patch: SettingsPatch) {
  assertCoach();
  // The logo is uploaded through /api/logo; what the browser holds is only a placeholder.
  if (patch.branding && "logo" in patch.branding) {
    const branding = { ...patch.branding };
    delete branding.logo;
    patch = { ...patch, branding };
  }
  const coach = await prisma.coach.findFirstOrThrow({ select: { id: true, settings: true } });
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(coach.settings) as Record<string, unknown>;
  } catch {}
  const next = mergeSettings(stored, patch);
  const json = JSON.stringify(next);
  await prisma.coach.update({ where: { id: coach.id }, data: { settings: json } });
  setActiveSettings(parseSettings(json));
  revalidatePath("/", "layout");
}

/** Puts one setting (or group) back to its default. */
export async function resetSetting(key: string) {
  assertCoach();
  const coach = await prisma.coach.findFirstOrThrow({ select: { id: true, settings: true } });
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(coach.settings) as Record<string, unknown>;
  } catch {}
  delete stored[key];
  const json = JSON.stringify(stored);
  await prisma.coach.update({ where: { id: coach.id }, data: { settings: json } });
  setActiveSettings(parseSettings(json));
  revalidatePath("/", "layout");
}

export async function updateAccount(patch: { name?: string }) {
  assertCoach();
  const data: { name?: string } = {};
  if (patch.name !== undefined) data.name = patch.name.trim() || "Coach";
  const coach = await prisma.coach.findFirstOrThrow({ select: { id: true } });
  await prisma.coach.update({ where: { id: coach.id }, data });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Whether Topset can write backups into `folder` — checked before the coach relies on it. */
export async function checkBackupFolder(folder: string): Promise<{ ok: boolean; message: string }> {
  assertCoach();
  const dir = folder.trim();
  if (dir === "") return { ok: true, message: "Backups go to the topset-backups folder beside the app." };
  if (!path.isAbsolute(dir)) return { ok: false, message: "Use a full path, e.g. D:\\Backups\\Topset." };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return { ok: true, message: "Topset can write there." };
  } catch {
    return { ok: false, message: "Topset can't write to that folder." };
  }
}
