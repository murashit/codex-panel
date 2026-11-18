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
    const attachmentSavePending = this.insertions.size > 0 && pendingAttachmentLinks(draft).some((link) => this.insertions.has(link.id));
    const composer = this.state.composer;
    if (!options.clearSuggestions && draft === composer.draft && attachmentSavePending === composer.attachmentSavePending) return;
    this.dispatch({ type: "composer/draft-set", draft, attachmentSavePending, ...options });
  }

  reset(): void {
    this.dispose();
    this.lifetime.activate();
  }

  blocksSubmission(canInterrupt: boolean): boolean {
    if (!this.state.composer.attachmentSavePending) return false;
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
    let start = selection?.start ?? draft.length;
    let end = selection?.end ?? draft.length;
    const last = this.insertions.size
      ? pendingAttachmentLinks(draft)
          .filter((link) => this.insertions.has(link.id) && start < link.end && end > link.start)
          .at(-1)
      : undefined;
    if (last) {
      start = last.end;
      end = last.end;
    }
    const placeholder = pendingAttachmentPlaceholder(id, files.length);
    const prefix = draft.slice(0, start);
    const suffix = draft.slice(end);
    const syntheticPrefix = prefix && !prefix.endsWith("\n") ? "\n" : "";
    const syntheticSuffix = suffix && !suffix.startsWith("\n") ? "\n" : "";
    const beforeCursor = prefix + syntheticPrefix + placeholder;
    const value = beforeCursor + syntheticSuffix + suffix;
    const pending = { id, displacedText: draft.slice(start, end), syntheticPrefix, syntheticSuffix };
    this.insertions.set(id, pending);
    this.options.setSelection(collapsedComposerSelection(value, beforeCursor.length));
    this.reconcileDraft(value, { clearSuggestions: true });
    this.options.focus();
    return pending;
  }

  private settlePendingSave(pending: PendingAttachmentSave, savedAttachments: readonly ComposerAttachment[] | null): void {
    this.insertions.delete(pending.id);
    let draft = this.state.composer.draft;
    const ranges = pendingAttachmentLinks(draft).filter((link) => link.id === pending.id);
    if (ranges.length === 0) return;
    let selection = this.options.selection();
    const markers = savedAttachments?.map((attachment) => attachment.marker).join("\n");
    for (const range of ranges.reverse()) {
      const replacement = markers
        ? replaceDraftRange(draft, range.start, range.end, markers)
        : replacePendingAttachmentWithOriginalText(draft, pending, range);
      selection = adjustedComposerSelection(selection, draft, replacement);
      draft = replacement.value;
    }
    this.options.setSelection(selection);
    if (savedAttachments !== null) this.options.onDraftReplaced(draft, savedAttachments);
    this.reconcileDraft(draft);
  }
}

interface PendingAttachmentSave {
  readonly id: number;
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
  return `[${label}](codex-panel-pending-attachment:${String(id)})`;
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

function pendingAttachmentLinks(draft: string): { id: number; start: number; end: number }[] {
  return Array.from(draft.matchAll(/\[[^[\]\r\n]*\]\(codex-panel-pending-attachment:([1-9]\d*)\)/g), (match) => ({
    id: Number(match[1]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function replaceDraftRange(draft: string, start: number, end: number, replacement: string): DraftReplacement {
  return {
    value: `${draft.slice(0, start)}${replacement}${draft.slice(end)}`,
    start,
    end,
    replacementLength: replacement.length,
  };
}
