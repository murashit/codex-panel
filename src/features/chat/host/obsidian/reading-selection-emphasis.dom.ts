import type { SelectionEmphasis } from "../../../../shared/ui/editor-selection-emphasis.obsidian";

const HIGHLIGHT_NAME = "codex-panel-reading-selection";

export function readingSelectionEmphases(root: HTMLElement) {
  const ownerWindow: { CSS?: { highlights?: HighlightRegistry }; Highlight?: typeof Highlight } | null = root.ownerDocument.defaultView;
  const registry = ownerWindow?.CSS?.highlights;
  const HighlightConstructor = ownerWindow?.Highlight;
  const highlight = registry && HighlightConstructor ? new HighlightConstructor() : null;
  let generation = 0;
  let disposed = false;

  const clear = (): void => {
    generation += 1;
    highlight?.clear();
    if (registry?.get(HIGHLIGHT_NAME) === highlight) registry.delete(HIGHLIGHT_NAME);
  };

  return {
    retain(range: Range): SelectionEmphasis | null {
      if (!highlight || !registry || disposed || !root.isConnected || range.collapsed) return null;
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
      const retainedRange = range.cloneRange();
      const retainedGeneration = generation;
      let retained = true;
      const setVisible = (visible: boolean): void => {
        if (!retained || disposed || generation !== retainedGeneration) return;
        if (visible) {
          highlight.add(retainedRange);
          registry.set(HIGHLIGHT_NAME, highlight);
        } else {
          highlight.delete(retainedRange);
          if (highlight.size === 0 && registry.get(HIGHLIGHT_NAME) === highlight) registry.delete(HIGHLIGHT_NAME);
        }
      };
      setVisible(true);
      return {
        setVisible,
        release: () => {
          setVisible(false);
          retained = false;
        },
      };
    },
    clear,
    dispose(): void {
      clear();
      disposed = true;
    },
  };
}
