import type { ComponentChild as UiNode } from "preact";
import { Icon, IconButton } from "../../../../shared/ui/icon.dom";

export interface ConversationHeaderProps {
  title: string;
  persistence:
    | { kind: "selectable"; ephemeral: boolean; disabled: boolean; onToggle: () => void }
    | { kind: "fixed"; ephemeral: boolean }
    | null;
}

export function ConversationHeader({ title, persistence }: ConversationHeaderProps): UiNode {
  const icon = persistence?.ephemeral ? "message-square-dashed" : "message-square";
  return (
    <div className="codex-panel__conversation-header">
      {persistence?.kind === "selectable" ? (
        <IconButton
          icon={icon}
          label={persistence.ephemeral ? "Use regular conversation" : "Use temporary conversation"}
          className="clickable-icon codex-panel-ui__nav-row-action codex-panel__conversation-persistence codex-panel__conversation-toggle"
          disabled={persistence.disabled}
          onClick={persistence.onToggle}
        />
      ) : persistence ? (
        <span
          className="codex-panel-ui__nav-row-action codex-panel__conversation-persistence"
          role="img"
          aria-label={persistence.ephemeral ? "Temporary conversation" : "Regular conversation"}
        >
          <Icon icon={icon} />
        </span>
      ) : (
        <span className="codex-panel-ui__nav-row-action codex-panel__conversation-persistence" aria-hidden="true" />
      )}
      <span className="codex-panel__conversation-title">{title}</span>
    </div>
  );
}
