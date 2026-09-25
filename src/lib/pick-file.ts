/** Opens the browser's file picker without a visible input; resolves null if nothing is picked. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

export type RestoreStatus = { tone: "ok" | "error"; text: string };

/**
 * Asks, then stages a backup for the desktop app to swap in on its next start. Null when
 * the coach backs out at the question.
 */
export async function restoreBackup(file: File): Promise<RestoreStatus | null> {
  if (!window.confirm(`Replace ALL data with the backup “${file.name}”?\n\nThe current data is kept as a backup first.`)) {
    return null;
  }
  try {
    const res = await fetch("/api/backup", { method: "POST", body: file });
    const body = (await res.json()) as { ok: boolean; error?: string; text?: string };
    return body.ok
      ? { tone: "ok", text: body.text ?? "Backup ready. Close Topset and open it again to finish restoring." }
      : { tone: "error", text: body.error ?? "Restore failed." };
  } catch {
    return { tone: "error", text: "Restore failed." };
  }
}
