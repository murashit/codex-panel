import type { ThreadStreamItem } from "./items";
import { isOptimisticUserDialogue, matchesOptimisticUserDialogue } from "./local-dialogue-ids";
import { isEquivalentTurnErrorNotice, isTerminalTurnErrorItem } from "./turn-error-notices";
import { mergeThreadStreamItem, userDialogueWithLocalContext } from "./updates";

export function reconcileTurnSnapshot(
  turnItems: readonly ThreadStreamItem[],
  displayItems: readonly ThreadStreamItem[],
): readonly ThreadStreamItem[] {
  if (!turnItems.length) return displayItems;
  const terminal = turnItems.find(isTerminalTurnErrorItem);
  const identified = turnItems.some((item) => item.kind === "dialogue" && item.role === "user" && item.clientId);
  const pending = displayItems.filter(isOptimisticUserDialogue);
  const aliases = new Map<string, ThreadStreamItem>();
  const saved = new Map(
    turnItems.map((item) => {
      if (item.kind === "dialogue" && item.role === "user") {
        const index = pending.findIndex((local) =>
          identified ? matchesOptimisticUserDialogue(local, item) : (local.copyText ?? local.text) === (item.copyText ?? item.text),
        );
        const local = pending[index];
        if (local) {
          pending.splice(index, 1);
          const canonical = userDialogueWithLocalContext(item, local);
          aliases.set(local.id, canonical);
          return [canonical.id, canonical] as const;
        }
      }
      return [item.id, item] as const;
    }),
  );

  const merged = new Map<string, ThreadStreamItem>();
  for (const row of displayItems) {
    if (terminal && (terminal.id === row.id || isEquivalentTurnErrorNotice(row, terminal))) continue;
    const canonical = aliases.get(row.id);
    // Without a client ID, matching text supplies context but the server supplies the position.
    if (canonical && !identified) continue;
    const item = canonical ?? row;
    const snapshot = saved.get(item.id);
    merged.set(item.id, snapshot && snapshot !== item ? mergeThreadStreamItem(item, snapshot) : item);
  }
  for (const [id, item] of saved) if (!merged.has(id)) merged.set(id, item);

  return [...merged.values()];
}
