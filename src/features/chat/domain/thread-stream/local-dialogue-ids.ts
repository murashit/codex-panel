import type { ThreadStreamDialogueItem, ThreadStreamItem } from "./items";

function isLocalUserDialogueId(id: string): boolean {
  return id.startsWith("local-user-") || id.startsWith("local-steer-");
}

export function isLocalSteerDialogueClientId(id: string | null | undefined): boolean {
  return id?.startsWith("local-steer-") ?? false;
}

export function isOptimisticUserDialogue(item: ThreadStreamItem): item is ThreadStreamDialogueItem & { role: "user" } {
  return (
    item.kind === "dialogue" &&
    item.role === "user" &&
    (isLocalUserDialogueId(item.id) || (item.provenance?.source === "localUser" && item.provenance.channel === "optimistic"))
  );
}

export function optimisticDialogueClientId(item: ThreadStreamDialogueItem): string {
  return item.clientId ?? item.id;
}
