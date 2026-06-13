import { type ComponentChild as UiNode } from "preact";
import { useEffect, useRef } from "preact/hooks";

import { activeTurnId } from "../../state/reducer";
import type { MessageStreamItem } from "../../message-stream/items";
import { timelineItemFromMessageStreamItem } from "../../message-stream/timeline/from-items";
import { IconButton } from "../../../../shared/ui/components";
import { listenDomEvent } from "../../../../shared/ui/dom-events";
import type { TextItemActionContext, TextMessageStreamItem } from "./context";

export function TextItemHeader({ item, context }: { item: TextMessageStreamItem; context: TextItemActionContext }): UiNode {
  const forkActionsOpen = context.forkActionsItemId === item.id;
  const roleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!forkActionsOpen) return;
    const doc = roleRef.current?.ownerDocument;
    if (!doc) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && roleRef.current?.contains(event.target)) return;
      context.onForkActionsToggle?.(null);
    };
    return listenDomEvent(doc, "pointerdown", closeOnOutsidePointer, true);
  }, [context, forkActionsOpen]);

  const copyAction =
    item.kind === "message" && context.copyText && isMessageCopyActionVisible(item, context) && !forkActionsOpen ? (
      <TextItemAction
        icon="copy"
        label="Copy message"
        className="codex-panel__copy-message"
        onClick={() => context.copyText?.(item.copyText ?? item.text)}
      />
    ) : null;

  return (
    <div ref={roleRef} className={`codex-panel__message-role${forkActionsOpen ? " codex-panel__message-role--fork-open" : ""}`}>
      <span>{displayRoleLabel(item)}</span>
      {forkActionsOpen && context.canForkItem?.(item) ? (
        <TextItemAction
          icon="archive"
          label="Fork and archive"
          className="codex-panel__fork-and-archive-message"
          onClick={() => {
            context.onForkActionsToggle?.(null);
            context.onForkItem?.(item, true);
          }}
        />
      ) : (
        copyAction
      )}
      {context.canForkItem?.(item) ? (
        <TextItemAction
          icon="git-fork"
          label={forkActionsOpen ? "Fork" : "Fork from here"}
          className="codex-panel__fork-message"
          onClick={() => {
            if (forkActionsOpen) {
              context.onForkActionsToggle?.(null);
              context.onForkItem?.(item, false);
            } else {
              context.onForkActionsToggle?.(item.id);
            }
          }}
        />
      ) : null}
      {context.canImplementPlanItem?.(item) ? (
        <TextItemAction
          icon="play"
          label="Implement plan"
          className="codex-panel__implement-plan"
          onClick={() => context.onImplementPlanItem?.(item)}
        />
      ) : null}
      {context.canRollbackItem?.(item) ? (
        <TextItemAction
          icon="undo-2"
          label="Rollback last turn"
          className="codex-panel__rollback-turn"
          onClick={() => context.onRollbackItem?.(item)}
        />
      ) : null}
    </div>
  );
}

function TextItemAction({
  icon,
  label,
  className,
  onClick,
}: {
  icon: string;
  label: string;
  className: string;
  onClick: () => void;
}): UiNode {
  return (
    <IconButton
      icon={icon}
      label={label}
      className={`clickable-icon codex-panel__message-action ${className}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    />
  );
}

function displayRoleLabel(item: MessageStreamItem): string {
  const timeline = timelineItemFromMessageStreamItem(item);
  if (timeline.semanticKind === "userInputResult") return "Input";
  if (timeline.authorship === "user") return "You";
  if (timeline.authorship === "assistant") return "Codex";
  return "System";
}

function isMessageCopyActionVisible(item: MessageStreamItem, context: Pick<TextItemActionContext, "turnLifecycle">): boolean {
  if (item.kind !== "message" || item.copyText === undefined) return false;
  const activeTurn = activeTurnId({ lifecycle: context.turnLifecycle });
  return !(activeTurn && item.role === "assistant" && item.turnId === activeTurn);
}
