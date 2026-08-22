import type { ButtonHTMLAttributes, ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { IconButton } from "../../../shared/ui/icon.dom";

type ButtonProps = ButtonHTMLAttributes & { disabled?: boolean | undefined };

export interface ThreadRowControlsProps {
  isPinned: boolean;
  renameDisabled?: boolean | undefined;
  archiveDisabled?: boolean | undefined;
  archiveConfirm: { active: boolean; defaultSaveMarkdown: boolean };
  classNames: {
    action: string;
    pin: string;
    pinned: string;
    archivePrimary: string;
    archiveAlternate: string;
  };
  onRename: () => void;
  onPinChange: (isPinned: boolean) => void;
  onArchiveStart: () => void;
  onArchiveConfirm: (saveMarkdown: boolean) => void;
}

export function ThreadRowControls({
  isPinned,
  renameDisabled,
  archiveDisabled,
  archiveConfirm,
  classNames,
  onRename,
  onPinChange,
  onArchiveStart,
  onArchiveConfirm,
}: ThreadRowControlsProps): UiNode {
  if (archiveConfirm.active) {
    return (
      <>
        <ArchiveModeButton
          saveMarkdown={archiveConfirm.defaultSaveMarkdown}
          className={classNames.archivePrimary}
          disabled={archiveDisabled}
          onConfirm={onArchiveConfirm}
        />
        <ArchiveModeButton
          saveMarkdown={!archiveConfirm.defaultSaveMarkdown}
          className={classNames.archiveAlternate}
          disabled={archiveDisabled}
          onConfirm={onArchiveConfirm}
        />
      </>
    );
  }

  return (
    <>
      <ThreadRowButton icon="pencil" label="Rename thread" className={classNames.action} disabled={renameDisabled} onAction={onRename} />
      <ThreadRowButton
        icon="archive"
        label="Archive thread"
        className={classNames.action}
        disabled={archiveDisabled}
        onAction={onArchiveStart}
      />
      <ThreadRowButton
        icon="star"
        label={isPinned ? "Unpin thread" : "Pin thread"}
        className={[classNames.pin, isPinned ? classNames.pinned : ""].filter(Boolean).join(" ")}
        aria-pressed={isPinned}
        onAction={() => {
          onPinChange(!isPinned);
        }}
      />
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
  useLayoutEffect(() => {
    if (!busy) focusRenameInput(inputRef.current);
  }, [value, busy]);

  return (
    <input
      ref={inputRef}
      className={`codex-panel-ui__nav-inline-input ${className}`}
      type="text"
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
    <ThreadRowButton
      icon={generating ? "x" : "sparkles"}
      label={generating ? "Cancel auto-name" : "Auto-name thread"}
      className={className}
      disabled={saving || (!generating && autoNameDisabled)}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onAction={generating ? onCancel : onStart}
    />
  );
}

function ArchiveModeButton({
  saveMarkdown,
  className,
  disabled,
  onConfirm,
}: {
  saveMarkdown: boolean;
  className: string;
  disabled?: boolean | undefined;
  onConfirm: (saveMarkdown: boolean) => void;
}): UiNode {
  return (
    <ThreadRowButton
      icon={saveMarkdown ? "save" : "trash"}
      label={saveMarkdown ? "Save and archive thread" : "Archive thread without saving"}
      className={className}
      disabled={disabled}
      onAction={() => {
        onConfirm(saveMarkdown);
      }}
    />
  );
}

function ThreadRowButton({
  icon,
  label,
  className,
  onAction,
  ...props
}: {
  icon: string;
  label: string;
  className: string;
  onAction: () => void;
} & Omit<ButtonProps, "className" | "onClick" | "type">): UiNode {
  return (
    <IconButton
      {...props}
      icon={icon}
      label={label}
      className={`clickable-icon codex-panel-ui__nav-row-action ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        onAction();
      }}
    />
  );
}

function focusRenameInput(input: HTMLInputElement | null): void {
  if (!input || input.ownerDocument.activeElement === input) return;
  input.focus();
  input.select();
}
