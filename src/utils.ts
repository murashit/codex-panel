import type { UserInput } from "./generated/app-server/v2/UserInput";

export function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

export function jsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function inputToText(content: UserInput[]): string {
  const hasText = content.some((item) => item.type === "text" && item.text.length > 0);
  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      if (item.type === "localImage") return `[local image] ${item.path}`;
      if (item.type === "image") return `[image] ${item.url}`;
      if (item.type === "mention") return hasText ? "" : `[@${item.name}] ${item.path}`;
      if (item.type === "skill") return hasText ? "" : `[$${item.name}] ${item.path}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function shortThreadId(threadId: string): string {
  return threadId.length <= 8 ? threadId : threadId.slice(0, 8);
}
