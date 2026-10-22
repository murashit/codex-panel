import { vi } from "vitest";
import type { ComposerMetaViewModel, ComposerShellProps } from "../../../../src/features/chat/ui/composer/composer";

export function composerMetaFixture(): ComposerMetaViewModel {
  return {
    fatal: null,
    context: {
      cells: [
        { text: "⣀", placeholder: true },
        { text: "⣀", placeholder: true },
        { text: "⣀", placeholder: true },
        { text: "⣀", placeholder: true },
      ],
      percent: "--%",
    },
    statusSummary: "Context unavailable, plan off, auto-review off, fast off, model default, reasoning effort default",
    model: "default",
    effort: null,
    planActive: false,
    autoReviewActive: false,
    fastAvailable: true,
    fastActive: false,
    modelChoices: [],
    effortChoices: [],
  };
}

export function composerPropsFixture(overrides: Partial<ComposerShellProps> = {}): ComposerShellProps {
  return {
    viewId: "view",
    draft: "",
    busy: false,
    action: "send",
    submissionDisabled: false,
    directInputDisabled: false,
    runtimeControlsDisabled: false,
    sendDisabled: false,
    webSubmissionCancellable: false,
    normalPlaceholder: "Ask Codex...",
    suggestions: [],
    selectedSuggestionIndex: 0,
    pendingSelection: null,
    onPendingSelectionApplied: vi.fn(),
    callbacks: composerCallbacks(),
    meta: composerMetaFixture(),
    onComposer: vi.fn(),
    ...overrides,
  };
}

export function composerCallbacks() {
  return {
    onInput: vi.fn(),
    onUpdateSuggestions: vi.fn(),
    onKeydown: vi.fn(),
    onPaste: vi.fn(),
    onDrop: vi.fn(),
    onDragOver: vi.fn(),
    onSendOrInterrupt: vi.fn(),
    onTogglePlan: vi.fn(),
    onToggleAutoReview: vi.fn(),
    onToggleFast: vi.fn(),
    onSuggestionHover: vi.fn(),
    onSuggestionInsert: vi.fn(),
  };
}
