import type { ThreadStreamItem, UserThreadStreamDialogueItem } from "./items";

function isLocalUserDialogueId(id: string): boolean {
  return id.startsWith("local-user-") || id.startsWith("local-steer-");
}

export function isLocalSteerDialogueClientId(id: string | null | undefined): boolean {
  return id?.startsWith("local-steer-") ?? false;
}

export function isOptimisticUserDialogue(item: ThreadStreamItem): item is UserThreadStreamDialogueItem {
  return (
    item.kind === "dialogue" &&
    item.role === "user" &&
    (isLocalUserDialogueId(item.id) || (item.provenance?.source === "localUser" && item.provenance.channel === "optimistic"))
  );
}

export function matchesOptimisticUserDialogue(local: ThreadStreamItem, observed: ThreadStreamItem): local is UserThreadStreamDialogueItem {
  return (
    observed.kind === "dialogue" &&
    observed.role === "user" &&
    Boolean(observed.clientId) &&
    isOptimisticUserDialogue(local) &&
    (local.clientId ?? local.id) === observed.clientId &&
    (!local.turnId || !observed.turnId || local.turnId === observed.turnId)
  );
}
