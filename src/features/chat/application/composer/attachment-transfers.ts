import { OwnerLifetime } from "../../../../shared/async/owner-lifetime";
import type { ChatState } from "../state/model";
import type { ChatAction } from "../state/reducer";
import type { ChatStateStore } from "../state/store";
import type { ComposerAttachment, ComposerAttachmentHandler } from "./attachments";
import { type ComposerSelection, collapsedComposerSelection } from "./selection";

interface ComposerAttachmentTransfersOptions {
  attachmentHandler: ComposerAttachmentHandler;
  stateStore: ChatStateStore;
  selection: () => ComposerSelection | null;
  focus: () => void;
  setSelection: (selection: ComposerSelection | null) => void;
  onDraftReplaced: (draft: string, attachments: readonly ComposerAttachment[]) => void;
  onError: (message: string) => void;
}

export class ComposerAttachmentTransfers {
  private readonly lifetime = new OwnerLifetime();
  private pendingSaveId = 0;
  private readonly insertions = new Map<number, PendingAttachmentSave>();

  constructor(private readonly options: ComposerAttachmentTransfersOptions) {}

  private get state(): ChatState {
    return this.options.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.options.stateStore.dispatch(action);
  }

  transfer(files: readonly File[]): void {
    if (files.length === 0) return;
    const lifetime = this.lifetime.signal();
    const pending = this.startPendingSave(files);
    void this.saveFiles(files, pending, lifetime);
  }

  reconcileDraft(draft = this.state.composer.draft, options: { clearSuggestions?: boolean } = {}): void {
    const ids = [...this.insertions.values()]
      .filter((pending) => pendingAttachmentLinkRange(draft, pending.destination) !== null)
      .map((pending) => pending.id);
    const composer = this.state.composer;
    if (
      !options.clearSuggestions &&
      draft === composer.draft &&
      ids.length === composer.pendingAttachmentSaveIds.length &&
      ids.every((id, index) => id === composer.pendingAttachmentSaveIds[index])
    )
      return;
    this.dispatch({ type: "composer/draft-set", draft, pendingAttachmentSaveIds: ids, ...options });
  }

  reset(): void {
    this.dispose();
    this.lifetime.activate();
  }

  blocksSubmission(canInterrupt: boolean): boolean {
    if (this.state.composer.pendingAttachmentSaveIds.length === 0) return false;
    return !(canInterrupt && this.state.composer.draft.trim().length === 0);
  }

  dispose(): void {
    this.lifetime.dispose();
    for (const pending of this.insertions.values()) this.settlePendingSave(pending, null);
  }

  private async saveFiles(files: readonly File[], pending: PendingAttachmentSave, lifetime: AbortSignal): Promise<void> {
    if (!this.lifetime.isCurrent(lifetime)) return;
    try {
      const result = await this.options.attachmentHandler.saveFiles(files);
      if (!this.lifetime.isCurrent(lifetime)) return;
      this.settlePendingSave(pending, result.attachments);
      if (result.failures.length > 0) {
        this.options.onError(
          `Could not save attachments:\n${result.failures.map((failure) => `${failure.name}: ${failure.message}`).join("\n")}`,
        );
      }
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime)) return;
      this.settlePendingSave(pending, null);
      this.options.onError(error instanceof Error ? error.message : String(error));
    }
  }

  private startPendingSave(files: readonly File[]): PendingAttachmentSave {
    const id = ++this.pendingSaveId;
    const draft = this.state.composer.draft;
    const source = this.options.selection();
    const selection = source && source.value === draft ? source : null;
    const placeholder = pendingAttachmentPlaceholder(id, files.length);
    const insertion = applyAttachmentMarkerInsertion(draft, selection?.start ?? draft.length, selection?.end ?? draft.length, [
      placeholder,
    ]);
    const placeholderOffset = insertion.insertedText.indexOf(placeholder);
    const pending = {
      id,
      destination: pendingAttachmentDestination(id),
      displacedText: selection ? draft.slice(selection.start, selection.end) : "",
      syntheticPrefix: insertion.insertedText.slice(0, placeholderOffset),
      syntheticSuffix: insertion.insertedText.slice(placeholderOffset + placeholder.length),
    };
    this.insertions.set(id, pending);
    this.options.setSelection(collapsedComposerSelection(insertion.value, insertion.cursor));
    this.reconcileDraft(insertion.value, { clearSuggestions: true });
    this.options.focus();
    return pending;
  }

  private settlePendingSave(pending: PendingAttachmentSave, savedAttachments: readonly ComposerAttachment[] | null): void {
    this.insertions.delete(pending.id);
    const draft = this.state.composer.draft;
    const range = pendingAttachmentLinkRange(draft, pending.destination);
    if (!range) return;
    const replacement = savedAttachments?.length
      ? replaceDraftRange(draft, range.start, range.end, savedAttachments.map((attachment) => attachment.marker).join("\n"))
      : replacePendingAttachmentWithOriginalText(draft, pending, range);
    this.options.setSelection(adjustedComposerSelection(this.options.selection(), draft, replacement));
    if (savedAttachments !== null) this.options.onDraftReplaced(replacement.value, savedAttachments);
    this.reconcileDraft(replacement.value);
  }
}

interface PendingAttachmentSave {
  readonly id: number;
  readonly destination: string;
  readonly displacedText: string;
  readonly syntheticPrefix: string;
  readonly syntheticSuffix: string;
}

interface DraftReplacement {
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly replacementLength: number;
}

function pendingAttachmentPlaceholder(id: number, fileCount: number): string {
  const label = fileCount === 1 ? "Saving attachment…" : `Saving ${String(fileCount)} attachments…`;
  return `[${label}](${pendingAttachmentDestination(id)})`;
}

function pendingAttachmentDestination(id: number): string {
  return `codex-panel-pending-attachment:${String(id)}`;
}

function replacePendingAttachmentWithOriginalText(
  draft: string,
  pending: PendingAttachmentSave,
  range: { start: number; end: number },
): DraftReplacement {
  const prefixStart = range.start - pending.syntheticPrefix.length;
  const start = prefixStart >= 0 && draft.slice(prefixStart, range.start) === pending.syntheticPrefix ? prefixStart : range.start;
  const suffixEnd = range.end + pending.syntheticSuffix.length;
  const end = draft.slice(range.end, suffixEnd) === pending.syntheticSuffix ? suffixEnd : range.end;
  return replaceDraftRange(draft, start, end, pending.displacedText);
}

function adjustedComposerSelection(
  selection: ComposerSelection | null,
  draft: string,
  replacement: DraftReplacement,
): ComposerSelection | null {
  if (!selection || selection.value !== draft || replacement.value === draft) return null;
  const adjust = (position: number): number => {
    if (position <= replacement.start) return position;
    if (position >= replacement.end) return position + replacement.replacementLength - (replacement.end - replacement.start);
    return replacement.start + replacement.replacementLength;
  };
  return {
    value: replacement.value,
    start: adjust(selection.start),
    end: adjust(selection.end),
    direction: selection.direction,
  };
}

function applyAttachmentMarkerInsertion(
  value: string,
  start: number,
  end: number,
  markers: readonly string[],
): { value: string; cursor: number; insertedText: string } {
  const prefix = value.slice(0, start);
  const suffix = value.slice(end);
  const before = prefix && !prefix.endsWith("\n") ? "\n" : "";
  const after = suffix && !suffix.startsWith("\n") ? "\n" : "";
  const inserted = markers.join("\n");
  const nextValue = `${prefix}${before}${inserted}${after}${suffix}`;
  return {
    value: nextValue,
    cursor: prefix.length + before.length + inserted.length,
    insertedText: `${before}${inserted}${after}`,
  };
}

function pendingAttachmentLinkRange(draft: string, destination: string): { start: number; end: number } | null {
  const suffix = `](${destination})`;
  const suffixStart = draft.indexOf(suffix);
  if (suffixStart < 0) return null;
  const start = draft.lastIndexOf("[", suffixStart);
  return start < 0 ? null : { start, end: suffixStart + suffix.length };
}

function replaceDraftRange(draft: string, start: number, end: number, replacement: string): DraftReplacement {
  return {
    value: `${draft.slice(0, start)}${replacement}${draft.slice(end)}`,
    start,
    end,
    replacementLength: replacement.length,
  };
}
