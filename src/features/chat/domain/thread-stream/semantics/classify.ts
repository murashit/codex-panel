import type { ThreadStreamItem } from "../items";
import { isLocalSteerDialogueClientId } from "../local-dialogue-ids";

// Roles follow the supplied history only; explicit steers do not consume a prompt slot.
export function threadStreamUserRoles(items: readonly ThreadStreamItem[]): ("initiator" | "steer" | null)[] {
  const seenTurns = new Set<string>();
  return items.map((item) => {
    if (item.kind !== "dialogue" || item.dialogueKind !== "user") return null;
    if (item.provenance?.source === "localUser" && item.provenance.interaction === "steer") return "steer";
    if (!item.turnId) return "initiator";
    const seen = seenTurns.has(item.turnId);
    seenTurns.add(item.turnId);
    return isLocalSteerDialogueClientId(item.clientId) || seen ? "steer" : "initiator";
  });
}
