/** One chat message's text, whoever writes it: trimmed, not empty, not a novel. */
export const MAX_MESSAGE = 4000;

export function cleanBody(body: string): string {
  const text = typeof body === "string" ? body.trim() : "";
  if (text === "") throw new Error("Write something first.");
  if (text.length > MAX_MESSAGE) throw new Error("That's too long for one message.");
  return text;
}
