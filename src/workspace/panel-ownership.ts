interface PanelOwnershipCandidate {
  readonly attached: boolean;
  readonly threadId: string | null;
  readonly active: boolean;
}

export function duplicatePanels<Panel extends PanelOwnershipCandidate>(panels: readonly Panel[]): ReadonlySet<Panel> {
  const ownedThreadIds = new Set<string>();
  const duplicates = new Set<Panel>();
  const ranked = [...panels].sort(
    (left, right) => Number(right.attached) - Number(left.attached) || Number(right.active) - Number(left.active),
  );
  for (const panel of ranked) {
    if (!panel.threadId) continue;
    if (ownedThreadIds.has(panel.threadId)) duplicates.add(panel);
    else ownedThreadIds.add(panel.threadId);
  }
  return duplicates;
}
