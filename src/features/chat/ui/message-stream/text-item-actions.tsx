import { type ComponentChild as UiNode } from "preact";
import { useEffect, useRef } from "preact/hooks";

import type { MessageStreamTextView } from "../../presentation/message-stream/text-view";
import { IconButton } from "../../../../shared/ui/components";
import { listenDomEvent } from "../../../../shared/ui/dom-events";
import type { TextItemActionContext } from "./context";

export function TextItemHeader({ view, context }: { view: MessageStreamTextView; context: TextItemActionContext }): UiNode {
  const forkActionsOpen = context.forkActionsItemId === view.id;
  const roleRef = useRef<HTMLDivElement | null>(null);
  const { fork, implementPlan, rollback } = view.actions;

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
    view.copyText !== undefined && context.copyText && !forkActionsOpen ? (
      <TextItemAction
        icon="copy"
        label="Copy message"
        className="codex-panel__copy-message"
        onClick={() => context.copyText?.(view.copyText ?? "")}
      />
    ) : null;

  return (
    <div ref={roleRef} className={`codex-panel__message-role${forkActionsOpen ? " codex-panel__message-role--fork-open" : ""}`}>
      <span>{view.roleLabel}</span>
      {forkActionsOpen && fork ? (
        <TextItemAction
          icon="archive"
          label="Fork and archive"
          className="codex-panel__fork-and-archive-message"
          onClick={() => {
            context.onForkActionsToggle?.(null);
            context.onFork?.(fork, true);
          }}
        />
      ) : (
        copyAction
      )}
      {fork ? (
        <TextItemAction
          icon={forkActionsOpen ? "file-plus-corner" : "lucide-split"}
          label={forkActionsOpen ? "Fork" : "Fork from here"}
          className="codex-panel__fork-message"
          onClick={() => {
            if (forkActionsOpen) {
              context.onForkActionsToggle?.(null);
              context.onFork?.(fork, false);
            } else {
              context.onForkActionsToggle?.(view.id);
            }
          }}
        />
      ) : null}
      {implementPlan ? (
        <TextItemAction
          icon="play"
          label="Implement plan"
          className="codex-panel__implement-plan"
          onClick={() => context.onImplementPlan?.(implementPlan)}
        />
      ) : null}
      {rollback ? (
        <TextItemAction
          icon="undo-2"
          label="Rollback last turn"
          className="codex-panel__rollback-turn"
          onClick={() => context.onRollback?.(rollback)}
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
