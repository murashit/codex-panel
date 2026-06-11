import { type ComponentChild as UiNode } from "preact";
import { useEffect, useRef } from "preact/hooks";

import { activeTurnId } from "../../state/reducer";
import type { DisplayItem } from "../../display/types";
import { IconButton } from "../../../../shared/ui/components";
import type { MessageActionContext, RenderableTextItem } from "./context";

export function MessageRole({ item, context }: { item: RenderableTextItem; context: MessageActionContext }): UiNode {
  const forkActionsKey = `message:fork-actions:${item.id}`;
  const forkActionsOpen = context.openDetails.has(forkActionsKey);
  const roleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!forkActionsOpen) return;
    const doc = roleRef.current?.ownerDocument;
    if (!doc) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && roleRef.current?.contains(event.target)) return;
      context.onDetailsToggle?.(forkActionsKey, false);
    };
    doc.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      doc.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [context, forkActionsKey, forkActionsOpen]);

  const copyAction =
    item.kind === "message" && context.copyText && isMessageCopyActionVisible(item, context) && !forkActionsOpen ? (
      <MessageAction
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
        <MessageAction
          icon="archive"
          label="Fork and archive"
          className="codex-panel__fork-and-archive-message"
          onClick={() => {
            context.onDetailsToggle?.(forkActionsKey, false);
            context.onForkItem?.(item, true);
          }}
        />
      ) : (
        copyAction
      )}
      {context.canForkItem?.(item) ? (
        <MessageAction
          icon="git-fork"
          label={forkActionsOpen ? "Fork" : "Fork from here"}
          className="codex-panel__fork-message"
          onClick={() => {
            if (forkActionsOpen) {
              context.onDetailsToggle?.(forkActionsKey, false);
              context.onForkItem?.(item, false);
            } else {
              context.onDetailsToggle?.(forkActionsKey, true);
            }
          }}
        />
      ) : null}
      {context.canImplementPlanItem?.(item) ? (
        <MessageAction
          icon="play"
          label="Implement plan"
          className="codex-panel__implement-plan"
          onClick={() => context.onImplementPlanItem?.(item)}
        />
      ) : null}
      {context.canRollbackItem?.(item) ? (
        <MessageAction
          icon="undo-2"
          label="Rollback last turn"
          className="codex-panel__rollback-turn"
          onClick={() => context.onRollbackItem?.(item)}
        />
      ) : null}
    </div>
  );
}

function MessageAction({
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

function isMessageCopyActionVisible(item: DisplayItem, context: Pick<MessageActionContext, "turnLifecycle">): boolean {
  if (item.kind !== "message" || item.copyText === undefined) return false;
  const activeTurn = activeTurnId({ lifecycle: context.turnLifecycle });
  return !(activeTurn && item.role === "assistant" && item.turnId === activeTurn);
}
