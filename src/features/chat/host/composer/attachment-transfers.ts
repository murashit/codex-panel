import { OwnerLifetime } from "../../../../shared/async/owner-lifetime";
import type { ComposerAttachment, ComposerAttachmentHandler } from "../../application/composer/attachments";
import { type ChatState, panelThreadId } from "../../application/state/model";
import type { ChatAction } from "../../application/state/reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { ComposerPendingSelection } from "../../ui/composer/composer";
import {
  applyComposerInsertionToElement,
  type ComposerElementSelection,
  composerRangeInsertionSource,
  composerSelectionSource,
} from "./element.dom";

interface ComposerAttachmentTransfersOptions {
  attachmentHandler: ComposerAttachmentHandler;
  stateStore: ChatStateStore;
  composerElement: () => HTMLTextAreaElement | null;
  setPendingSelection: (selection: ComposerPendingSelection | null) => void;
  onDraftReplaced: (draft: string) => void;
  onError: (message: string) => void;
}

export class ComposerAttachmentTransfers {
  private readonly lifetime = new OwnerLifetime();
  private attachments: ComposerAttachment[] = [];
  private pendingSaveId = 0;
  private pendingSaves = new Map<number, PendingAttachmentSave>();

  constructor(private readonly options: ComposerAttachmentTransfersOptions) {}

  private get state(): ChatState {
    return this.options.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.options.stateStore.dispatch(action);
  }

  snapshot(): readonly ComposerAttachment[] {
    return [...this.attachments];
  }

  restore(attachments: readonly ComposerAttachment[]): void {
    this.attachments = [...attachments];
  }

  restoreClaimed(attachments: readonly ComposerAttachment[]): void {
    this.attachments = mergeByMarker(attachments, this.attachments);
  }

  clear(): void {
    this.attachments = [];
  }

  prune(draft: string): void {
    this.attachments = this.activeAttachments(draft);
  }

  transfer(files: readonly File[]): void {
    if (files.length === 0) return;
    const pending = this.startPendingSave(files);
    this.pendingSaves.set(pending.id, pending);
    void this.saveFiles(files, pending).finally(() => {
      this.pendingSaves.delete(pending.id);
    });
  }

  blocksSubmission(canInterrupt: boolean): boolean {
    if (this.state.composer.pendingAttachmentSaveIds.length === 0) return false;
    return !(canInterrupt && this.state.composer.draft.trim().length === 0);
  }

  dispose(): void {
    this.lifetime.dispose();
    for (const pending of this.pendingSaves.values()) this.settlePendingSave(pending);
    this.pendingSaves.clear();
  }

  private async saveFiles(files: readonly File[], pending: PendingAttachmentSave): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime)) return;
    try {
      const attachments = await this.options.attachmentHandler.saveFiles(files);
      if (!this.lifetime.isCurrent(lifetime)) return;
      this.completePendingSave(pending, attachments);
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime)) return;
      this.settlePendingSave(pending);
      this.options.onError(error instanceof Error ? error.message : String(error));
    }
  }

  private startPendingSave(files: readonly File[]): PendingAttachmentSave {
    const id = ++this.pendingSaveId;
    const draft = this.state.composer.draft;
    const composer = this.options.composerElement();
    const source = composerRangeInsertionSource(composer);
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
      panelTargetRevision: this.state.panelTargetRevision,
      threadId: panelThreadId(this.state),
    };
    this.options.setPendingSelection(collapsedComposerSelection(insertion.value, insertion.cursor));
    this.dispatch({ type: "composer/attachment-save-started", saveId: id, draft: insertion.value });
    applyComposerInsertionToElement(composer, insertion.cursor);
    return pending;
  }

  private completePendingSave(pending: PendingAttachmentSave, attachments: readonly ComposerAttachment[]): void {
    const markers = attachments.map((attachment) => attachment.marker);
    const state = this.state;
    if (
      state.panelTargetRevision !== pending.panelTargetRevision ||
      panelThreadId(state) !== pending.threadId ||
      !state.composer.pendingAttachmentSaveIds.includes(pending.id)
    ) {
      this.settlePendingSave(pending);
      return;
    }

    const replacement =
      markers.length === 0
        ? replacePendingAttachmentWithOriginalText(state.composer.draft, pending)
        : replacePendingAttachmentPlaceholder(state.composer.draft, pending, markers);
    this.options.setPendingSelection(
      adjustedComposerSelection(composerSelectionSource(this.options.composerElement()), state.composer.draft, replacement),
    );
    this.attachments = [...this.attachments, ...attachments];
    this.prune(replacement.value);
    this.options.onDraftReplaced(replacement.value);
    this.dispatch({ type: "composer/attachment-save-settled", saveId: pending.id, draft: replacement.value });
  }

  private settlePendingSave(pending: PendingAttachmentSave): void {
    const state = this.state;
    if (!state.composer.pendingAttachmentSaveIds.includes(pending.id)) return;
    const replacement = replacePendingAttachmentWithOriginalText(state.composer.draft, pending);
    this.options.setPendingSelection(
      adjustedComposerSelection(composerSelectionSource(this.options.composerElement()), state.composer.draft, replacement),
    );
    this.dispatch({ type: "composer/attachment-save-settled", saveId: pending.id, draft: replacement.value });
  }

  private activeAttachments(draft: string): ComposerAttachment[] {
    return this.attachments
      .filter((attachment) => draft.includes(attachment.marker))
      .sort((left, right) => draft.indexOf(left.marker) - draft.indexOf(right.marker));
  }
}

function mergeByMarker(claimed: readonly ComposerAttachment[], current: readonly ComposerAttachment[]): ComposerAttachment[] {
  const merged = new Map<string, ComposerAttachment>();
  for (const attachment of claimed) merged.set(attachment.marker, attachment);
  for (const attachment of current) merged.set(attachment.marker, attachment);
  return [...merged.values()];
}

function collapsedComposerSelection(value: string, cursor: number): ComposerPendingSelection {
  return { value, start: cursor, end: cursor, direction: "none" };
}

interface PendingAttachmentSave {
  readonly id: number;
  readonly destination: string;
  readonly displacedText: string;
  readonly syntheticPrefix: string;
  readonly syntheticSuffix: string;
  readonly panelTargetRevision: number;
  readonly threadId: string | null;
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

function replacePendingAttachmentPlaceholder(draft: string, pending: PendingAttachmentSave, markers: readonly string[]): DraftReplacement {
  const range = pendingAttachmentLinkRange(draft, pending.destination);
  return range ? replaceDraftRange(draft, range.start, range.end, markers.join("\n")) : unchangedDraftReplacement(draft);
}

function replacePendingAttachmentWithOriginalText(draft: string, pending: PendingAttachmentSave): DraftReplacement {
  const range = pendingAttachmentLinkRange(draft, pending.destination);
  if (!range) return unchangedDraftReplacement(draft);
  const prefixStart = range.start - pending.syntheticPrefix.length;
  const start = prefixStart >= 0 && draft.slice(prefixStart, range.start) === pending.syntheticPrefix ? prefixStart : range.start;
  const suffixEnd = range.end + pending.syntheticSuffix.length;
  const end = draft.slice(range.end, suffixEnd) === pending.syntheticSuffix ? suffixEnd : range.end;
  return replaceDraftRange(draft, start, end, pending.displacedText);
}

function adjustedComposerSelection(
  selection: ComposerElementSelection | null,
  draft: string,
  replacement: DraftReplacement,
): ComposerPendingSelection | null {
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

function unchangedDraftReplacement(draft: string): DraftReplacement {
  return { value: draft, start: draft.length, end: draft.length, replacementLength: 0 };
}
