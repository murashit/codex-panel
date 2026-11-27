import type { ThreadStreamItem } from "./items";
import { isOptimisticUserDialogue, matchesOptimisticUserDialogue } from "./local-dialogue-ids";
import { isEquivalentTurnErrorNotice, isTerminalTurnErrorItem } from "./turn-error-notices";
import { mergeThreadStreamItem, userDialogueWithLocalContext } from "./updates";

export function reconcileTurnSnapshot(
  turnItems: readonly ThreadStreamItem[],
  displayItems: readonly ThreadStreamItem[],
  liveItems: readonly ThreadStreamItem[] = [],
): readonly ThreadStreamItem[] {
  if (!turnItems.length && !liveItems.length) return displayItems;
  const terminal = turnItems.find(isTerminalTurnErrorItem);
  const identified = turnItems.some((item) => item.kind === "dialogue" && item.role === "user" && item.clientId);
  const pending = [...new Map([...displayItems, ...liveItems].filter(isOptimisticUserDialogue).map((item) => [item.id, item])).values()];
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

  const visible = (items: readonly ThreadStreamItem[]) =>
    items.flatMap((item) => {
      if (terminal && (terminal.id === item.id || isEquivalentTurnErrorNotice(item, terminal))) return [];
      const canonical = aliases.get(item.id);
      // Without a client ID, matching text supplies context but the server supplies the position.
      if (canonical) return identified ? [canonical] : [];
      return [item];
    });
  const merged = new Map<string, ThreadStreamItem>();
  for (const item of visible(displayItems)) {
    const snapshot = saved.get(item.id);
    merged.set(item.id, snapshot && snapshot !== item ? mergeThreadStreamItem(item, snapshot) : item);
  }
  for (const [id, item] of saved) if (!merged.has(id)) merged.set(id, item);

  if (!liveItems.length) return [...merged.values()];

  // The recorded prompt leads its turn even when delivered after its first output. Other shared rows anchor intervening live activity.
  const promptId = turnItems.find((item) => item.kind === "dialogue" && item.role === "user")?.id;
  const before = new Map<string, ThreadStreamItem[]>();
  let newRows: ThreadStreamItem[] = [];
  for (const item of visible(liveItems)) {
    if (merged.has(item.id)) {
      if (item.id !== promptId && newRows.length) {
        before.set(item.id, newRows);
        newRows = [];
      }
      merged.set(item.id, item);
    } else newRows.push(item);
  }
  return [...[...merged.values()].flatMap((item) => [...(before.get(item.id) ?? []), item]), ...newRows];
}
