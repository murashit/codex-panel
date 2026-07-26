import type { ThreadStreamDialogueItem } from "../../domain/thread-stream/items";

export function pendingWebSubmissionItem(id: string, url: string, message: string): ThreadStreamDialogueItem | null {
  const normalizedUrl = normalizedHttpUrl(url);
  if (!normalizedUrl) return null;
  const text = [normalizedUrl, message.trim()].filter(Boolean).join(" ");
  return {
    id,
    kind: "dialogue",
    dialogueKind: "user",
    role: "user",
    text,
    copyText: text,
    executionState: "running",
    contextAttachments: [{ label: "Web page", detail: normalizedUrl }],
    provenance: { source: "localUser", channel: "preflight", interaction: "prompt", sourceId: id },
  };
}

export function normalizedHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
