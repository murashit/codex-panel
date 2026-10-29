import { isComposerSendKey, type SendShortcut } from "../../../../domain/input/send-shortcut";
import { ComposerInput, type ComposerInputOptions } from "../../application/composer/input";
import { composerSuggestionNavigationDirection } from "../../application/composer/suggestion";
import type { ChatState } from "../../application/state/model";
import { ordinaryComposerAction } from "../../domain/composer/action";
import type { ComposerCallbacks, ComposerPendingSelection, ComposerShellProps } from "../../ui/composer/composer";
import { type ComposerBoundaryScrollAction, composerBoundaryScrollActionFromElement } from "../thread-stream/composer-scroll";
import { composerFilesFromTransfer, composerTransferHasFiles } from "./file-transfers.dom";
import { composerSelectionSource } from "./selection";
import type { ChatPanelComposerActions, ChatPanelComposerModel } from "./view-projection";
import { type ChatPanelComposerRuntimeActions, projectChatPanelComposer } from "./view-projection";

interface ChatComposerControllerOptions extends Omit<ComposerInputOptions, "view"> {
  viewId: string;
  sendShortcut: () => SendShortcut;
  scrollThreadFromComposerEdges: () => boolean;
  runtimeActions: ChatPanelComposerRuntimeActions;
  threadScrollFromComposer: (action: ComposerBoundaryScrollAction) => void;
  togglePlan: () => void;
  toggleAutoReview: () => void;
  toggleFast: () => void;
  canFocus: () => boolean;
}

function composerCanInterrupt(model: ChatPanelComposerModel): boolean {
  return model.turnBusy && Boolean(model.activeThreadId && model.activeTurnId);
}

export class ChatComposerController {
  readonly input: ComposerInput;
  private composer: HTMLTextAreaElement | null = null;
  private pendingSelection: ComposerPendingSelection | null = null;

  constructor(private readonly options: ChatComposerControllerOptions) {
    this.input = new ComposerInput({
      fuzzyMatcher: options.fuzzyMatcher,
      noteCandidateProvider: options.noteCandidateProvider,
      contextReferenceProvider: options.contextReferenceProvider,
      attachmentHandler: options.attachmentHandler,
      sourcePath: options.sourcePath,
      stateStore: options.stateStore,
      referenceActiveNoteOnSend: options.referenceActiveNoteOnSend,
      onAttachmentError: options.onAttachmentError,
      sharedResources: options.sharedResources,
      view: {
        selection: () => composerSelectionSource(this.composer),
        setSelection: (selection) => {
          this.pendingSelection = selection;
        },
        focus: (focusOptions) => {
          if (focusOptions?.force || options.canFocus()) this.composer?.focus();
        },
      },
    });
  }

  private get state(): ChatState {
    return this.options.stateStore.getState();
  }

  renderState(model: ChatPanelComposerModel, actions: ChatPanelComposerActions): ComposerShellProps {
    const projection = projectChatPanelComposer(model, this.options.runtimeActions);
    return {
      cancelFork:
        model.forkDraft && actions.cancelFork
          ? {
              onCancel: actions.cancelFork,
              disabled:
                model.submissionBlockedByPanelPolicy ||
                model.webSubmissionPending ||
                model.attachmentSavePending ||
                this.input.isSubmissionPreparing(),
            }
          : undefined,
      viewId: this.options.viewId,
      draft: model.draft,
      busy: model.turnBusy,
      action: ordinaryComposerAction({
        canInterrupt: composerCanInterrupt(model),
        hasDraft: model.draft.trim().length > 0,
        directInputBlocked: model.submissionBlockedByPanelPolicy,
      }),
      submissionDisabled: model.webSubmissionPending,
      directInputDisabled: model.submissionBlockedByPanelPolicy,
      runtimeControlsDisabled: model.runtimeSettingsDisabled,
      sendDisabled: model.attachmentSavePending,
      webSubmissionCancellable: model.webSubmissionCancellable,
      normalPlaceholder: projection.placeholder,
      suggestions: model.suggestions,
      selectedSuggestionIndex: model.selectedSuggestionIndex,
      pendingSelection: this.pendingSelection,
      onPendingSelectionApplied: this.clearPendingSelection,
      callbacks: this.composerCallbacks(actions, model),
      meta: projection.meta,
      onComposer: this.setComposerElement,
    };
  }

  private readonly setComposerElement = (composer: HTMLTextAreaElement | null): void => {
    this.composer = composer;
  };

  focusComposer(options: { force?: boolean } = {}): void {
    if (options.force !== true && !this.options.canFocus()) return;
    this.composer?.focus({ preventScroll: true });
  }

  hasFocus(): boolean {
    return this.composer !== null && this.composer.ownerDocument.activeElement === this.composer;
  }

  dispose(): void {
    this.input.dispose();
    this.composer = null;
  }

  private handleSuggestionKeydown(event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    const state = this.state;
    if (state.composer.suggestions.length === 0) return false;

    const direction = composerSuggestionNavigationDirection(event);
    if (direction) {
      event.preventDefault();
      this.input.navigateSuggestions(direction);
      return true;
    }
    if (event.metaKey || event.ctrlKey) return false;

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.input.insertSuggestion(state.composer.suggestions[state.composer.suggestSelected], event.key === "Tab" ? "tab" : "enter");
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.input.dismissSuggestions();
      return true;
    }

    return false;
  }

  private handleBoundaryScrollKeydown(event: KeyboardEvent): boolean {
    const action = composerBoundaryScrollActionFromElement(event, this.composer);
    if (!action) return false;
    if (action.kind === "scroll-by" && action.amount === "text-lines" && !this.options.scrollThreadFromComposerEdges()) return false;

    event.preventDefault();
    this.options.threadScrollFromComposer(action);
    return true;
  }

  private readonly clearPendingSelection = (): void => {
    this.pendingSelection = null;
  };

  private composerCallbacks(actions: ChatPanelComposerActions, model: ChatPanelComposerModel): ComposerCallbacks {
    const sendOrInterrupt = () => {
      if (this.state.pendingSubmission?.phase === "cancellable") {
        actions.submit();
        return;
      }
      if (this.state.pendingSubmission || this.input.attachmentSaveBlocksSubmit(composerCanInterrupt(model))) return;
      if (this.input.editable || composerCanInterrupt(model)) actions.submit();
    };
    const transferAttachments = (event: Event, transfer: DataTransfer | null) => {
      if (!this.input.editable) return;
      const files = composerFilesFromTransfer(transfer);
      if (files.length === 0) return;
      event.preventDefault();
      this.input.transferAttachments(files);
    };
    return {
      onInput: (value) => {
        this.input.editDraft(value);
      },
      onUpdateSuggestions: () => {
        this.input.updateSuggestions();
      },
      onKeydown: (event) => {
        if (this.input.editable && this.handleSuggestionKeydown(event)) {
          return;
        }
        if (this.handleBoundaryScrollKeydown(event)) {
          return;
        }
        if (isComposerSendKey(event, this.options.sendShortcut())) {
          event.preventDefault();
          sendOrInterrupt();
        }
      },
      onPaste: (event) => {
        transferAttachments(event, event.clipboardData);
      },
      onDrop: (event) => {
        transferAttachments(event, event.dataTransfer);
      },
      onDragOver: (event) => {
        if (!composerTransferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      },
      onSendOrInterrupt: sendOrInterrupt,
      onTogglePlan: () => {
        this.options.togglePlan();
      },
      onToggleAutoReview: () => {
        this.options.toggleAutoReview();
      },
      onToggleFast: () => {
        this.options.toggleFast();
      },
      onSuggestionHover: (index) => {
        this.input.selectSuggestion(index);
      },
      onSuggestionInsert: (suggestion) => {
        this.input.insertSuggestion(suggestion);
      },
    };
  }
}
