import { truncate } from "../../../../domain/display/text-preview";

export function agentMessagePreview(message: string | null, maxLength: number): string | null {
  if (!message) return null;
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  return truncate(firstLine.replace(/\s+/g, " "), maxLength);
}
