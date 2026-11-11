import type { ButtonHTMLAttributes, Ref, TargetedFocusEvent, TargetedMouseEvent, ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { IconButton } from "../../../shared/ui/icon.dom";

type ButtonProps = ButtonHTMLAttributes & { disabled?: boolean | undefined };

let nextRenameLabelId = 0;

export interface ThreadActionControlsProps {
  isPinned?: boolean | undefined;
  renameDisabled?: boolean | undefined;
  archiveDisabled?: boolean | undefined;
  /** Only for surfaces that close confirmation synchronously on activation. */
  manageArchiveFocus?: boolean | undefined;
  archiveConfirm: { active: boolean; defaultSaveMarkdown: boolean };
  classNames: {
    action: string;
    pin?: string | undefined;
    pinned?: string | undefined;
    archivePrimary: string;
    archiveAlternate: string;
  };
  onRename: () => void;
  onPinChange?: ((isPinned: boolean) => void) | undefined;
  onArchiveStart: () => void;
  onArchiveConfirm: (saveMarkdown: boolean) => void;
}

export function ThreadActionControls({
  isPinned,
  renameDisabled,
  archiveDisabled,
  manageArchiveFocus,
  archiveConfirm,
  classNames,
  onRename,
  onPinChange,
  onArchiveStart,
  onArchiveConfirm,
}: ThreadActionControlsProps): UiNode {
  const focusTarget = useRef<HTMLButtonElement | null>(null);
  const focusOnTransition = useRef(false);
  useLayoutEffect(() => {
    if (focusOnTransition.current) {
      focusOnTransition.current = false;
      focusTarget.current?.focus();
    }
  }, [archiveConfirm.active]);
  const rememberFocus = (event: TargetedMouseEvent<HTMLButtonElement>): void => {
    focusOnTransition.current = manageArchiveFocus === true && event.currentTarget === event.currentTarget.ownerDocument.activeElement;
  };
  const confirmArchive = (saveMarkdown: boolean, event: TargetedMouseEvent<HTMLButtonElement>): void => {
    rememberFocus(event);
    onArchiveConfirm(saveMarkdown);
  };

  if (archiveConfirm.active) {
    return (
      <>
        <ArchiveModeButton
          saveMarkdown={archiveConfirm.defaultSaveMarkdown}
          buttonRef={focusTarget}
          className={classNames.archivePrimary}
          disabled={archiveDisabled}
          onConfirm={confirmArchive}
        />
        <ArchiveModeButton
          saveMarkdown={!archiveConfirm.defaultSaveMarkdown}
          className={classNames.archiveAlternate}
          disabled={archiveDisabled}
          onConfirm={confirmArchive}
        />
      </>
    );
  }

  return (
    <>
      <ThreadControlButton
        icon="pencil"
        label="Rename thread"
        className={classNames.action}
        disabled={renameDisabled}
        onAction={() => {
          onRename();
        }}
      />
      <ThreadControlButton
        icon="archive"
        label="Archive thread"
        className={classNames.action}
        buttonRef={focusTarget}
        disabled={archiveDisabled}
        onAction={(event) => {
          rememberFocus(event);
          onArchiveStart();
        }}
      />
      {onPinChange ? (
        <ThreadControlButton
          icon="star"
          label={isPinned ? "Unpin thread" : "Pin thread"}
          className={[classNames.pin, isPinned ? classNames.pinned : ""].filter(Boolean).join(" ")}
          aria-pressed={isPinned === true}
          onAction={() => {
            onPinChange(!isPinned);
          }}
        />
      ) : null}
    </>
  );
}

export interface ThreadRenameControlActions {
  updateDraft: (threadId: string, value: string) => void;
  save: (threadId: string, value: string) => void;
  cancel: (threadId: string) => void;
  autoName: (threadId: string) => void;
  cancelAutoName: (threadId: string) => void;
}

export function threadRenameControls({
  threadId,
  state,
  classNames,
  actions,
}: {
  threadId: string;
  state: { draft: string; generating: boolean; saving: boolean; autoNameDisabled: boolean };
  classNames: { input: string; action: string };
  actions: ThreadRenameControlActions;
}): { input: UiNode; action: UiNode; onFocusOut: (event: TargetedFocusEvent<HTMLElement>) => void } {
  const busy = state.generating || state.saving;
  const save = (value: string) => {
    actions.save(threadId, value);
  };
  return {
    input: (
      <ThreadRenameInput
        className={classNames.input}
        value={state.draft}
        busy={busy}
        onUpdate={(value) => {
          actions.updateDraft(threadId, value);
        }}
        onSave={save}
        onCancel={() => {
          actions.cancel(threadId);
        }}
      />
    ),
    action: (
      <ThreadControlButton
        icon={state.generating ? "x" : "sparkles"}
        label={state.generating ? "Cancel auto-name" : "Auto-name thread"}
        className={classNames.action}
        disabled={state.saving || (!state.generating && state.autoNameDisabled)}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onAction={() => {
          if (state.generating) actions.cancelAutoName(threadId);
          else actions.autoName(threadId);
        }}
      />
    ),
    onFocusOut: (event) => {
      const next = event.relatedTarget;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- A browser focus target exposing nodeType is a Node; avoid a realm-specific instanceof check for adopted nodes.
      if (busy || (next && "nodeType" in next && event.currentTarget.contains(next as Node))) return;
      save(state.draft);
    },
  };
}

function ThreadRenameInput({
  className,
  value,
  busy,
  onUpdate,
  onSave,
  onCancel,
}: {
  className: string;
  value: string;
  busy: boolean;
  onUpdate: (value: string) => void;
  onSave: (value: string) => void;
  onCancel: () => void;
}): UiNode {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const labelId = useRef<string | null>(null);
  if (labelId.current === null) labelId.current = `codex-panel-thread-name-${String(++nextRenameLabelId)}`;
  useLayoutEffect(() => {
    if (!busy) focusRenameInput(inputRef.current);
  }, [value, busy]);

  return (
    <>
      <span id={labelId.current} hidden>
        Thread name
      </span>
      <input
        ref={inputRef}
        className={`codex-panel-ui__nav-inline-input ${className}`}
        type="text"
        aria-labelledby={labelId.current}
        value={value}
        disabled={busy}
        onInput={(event) => {
          onUpdate(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (!event.isComposing && !busy) onSave(event.currentTarget.value);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            if (!busy) onCancel();
          }
        }}
      />
    </>
  );
}

function ArchiveModeButton({
  saveMarkdown,
  className,
  buttonRef,
  disabled,
  onConfirm,
}: {
  saveMarkdown: boolean;
  className: string;
  buttonRef?: Ref<HTMLButtonElement> | undefined;
  disabled?: boolean | undefined;
  onConfirm: (saveMarkdown: boolean, event: TargetedMouseEvent<HTMLButtonElement>) => void;
}): UiNode {
  return (
    <ThreadControlButton
      icon={saveMarkdown ? "save" : "trash"}
      label={saveMarkdown ? "Save and archive thread" : "Archive thread without saving"}
      className={className}
      buttonRef={buttonRef}
      disabled={disabled}
      onAction={(event) => {
        onConfirm(saveMarkdown, event);
      }}
    />
  );
}

function ThreadControlButton({
  icon,
  label,
  className,
  buttonRef,
  onAction,
  ...props
}: {
  icon: string;
  label: string;
  className: string;
  buttonRef?: Ref<HTMLButtonElement> | undefined;
  onAction: (event: TargetedMouseEvent<HTMLButtonElement>) => void;
} & Omit<ButtonProps, "className" | "onClick" | "type">): UiNode {
  return (
    <IconButton
      {...props}
      icon={icon}
      label={label}
      buttonRef={buttonRef}
      className={`clickable-icon codex-panel-ui__nav-row-action ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        onAction(event);
      }}
    />
  );
}

function focusRenameInput(input: HTMLInputElement | null): void {
  if (!input || input.ownerDocument.activeElement === input) return;
  input.focus();
  input.select();
}
