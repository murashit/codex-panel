import type { ComponentChild as UiNode } from "preact";

import { IconButton } from "../../../../shared/ui/icon.dom";

export function OpenAgentThreadAction({
  threadId,
  openThreadInNewView,
}: {
  threadId: string;
  openThreadInNewView: (threadId: string) => void;
}): UiNode {
  return (
    <IconButton
      icon="external-link"
      label="Open agent thread"
      className="clickable-icon codex-panel__hover-action codex-panel__agent-open-thread"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openThreadInNewView(threadId);
      }}
    />
  );
}
