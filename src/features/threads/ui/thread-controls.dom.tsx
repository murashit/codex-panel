import type { ButtonHTMLAttributes, Ref, TargetedMouseEvent, ComponentChild as UiNode } from "preact";
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

export function ThreadRenameInput({
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
        onBlur={(event) => {
          if (!busy) onSave(event.currentTarget.value);
        }}
      />
    </>
  );
}

export function ThreadAutoNameButton({
  className,
  generating,
  saving,
  autoNameDisabled,
  onStart,
  onCancel,
}: {
  className: string;
  generating: boolean;
  saving: boolean;
  autoNameDisabled: boolean;
  onStart: () => void;
  onCancel: () => void;
}): UiNode {
  return (
    <ThreadControlButton
      icon={generating ? "x" : "sparkles"}
      label={generating ? "Cancel auto-name" : "Auto-name thread"}
      className={className}
      disabled={saving || (!generating && autoNameDisabled)}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onAction={() => {
        if (generating) onCancel();
        else onStart();
      }}
    />
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
