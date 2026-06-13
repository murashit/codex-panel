import { type ComponentChild as UiNode } from "preact";
import { useEffect, useRef } from "preact/hooks";

import { activeTurnId } from "../../state/reducer";
import type { DisplayItem } from "../../display/types";
import { IconButton } from "../../../../shared/ui/components";
import { listenDomEvent } from "../../../../shared/ui/dom-events";
import type { TextItemActionContext, TextDisplayItem } from "./context";

export function TextItemHeader({ item, context }: { item: TextDisplayItem; context: TextItemActionContext }): UiNode {
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

function displayRoleLabel(item: DisplayItem): string {
  if (item.kind === "approvalResult") return "Approval";
  if (item.kind === "userInputResult") return "Input";
  if (item.kind === "reviewResult") return "Review";
  if (item.role === "user") return "You";
  if (item.role === "assistant") return "Codex";
  return "System";
}

function isMessageCopyActionVisible(item: DisplayItem, context: Pick<TextItemActionContext, "turnLifecycle">): boolean {
  if (item.kind !== "message" || item.copyText === undefined) return false;
  const activeTurn = activeTurnId({ lifecycle: context.turnLifecycle });
  return !(activeTurn && item.role === "assistant" && item.turnId === activeTurn);
}
