import type { ComposerSuggestion } from "../composer/suggestion";
import { patchObject } from "./patch";

export interface ChatComposerState {
  readonly draft: string;
  readonly pendingAttachmentSaveIds: readonly number[];
  readonly suggestSelected: number;
  readonly suggestions: readonly ComposerSuggestion[];
  readonly suggestionsDismissedSignature: string | null;
}

export type ComposerAction =
  | {
      type: "composer/attachment-save-started";
      saveId: number;
      draft: string;
    }
  | {
      type: "composer/attachment-save-settled";
      saveId: number;
      draft?: string;
    }
  | {
      type: "composer/draft-set";
      draft: string;
      clearSuggestions?: boolean;
      resetDismissedSignature?: boolean;
    }
  | {
      type: "composer/input-set";
      draft: string;
      suggestions: readonly ComposerSuggestion[];
      selected?: number;
      dismissedSignature?: string | null;
    }
  | {
      type: "composer/suggestions-set";
      suggestions: readonly ComposerSuggestion[];
      selected?: number;
      dismissedSignature?: string | null;
    };

export function initialComposerState(): ChatComposerState {
  return {
    draft: "",
    pendingAttachmentSaveIds: [],
    suggestSelected: 0,
    suggestions: [],
    suggestionsDismissedSignature: null,
  };
}

export function reduceComposerSlice(state: ChatComposerState, action: ComposerAction): ChatComposerState {
  switch (action.type) {
    case "composer/attachment-save-started":
      return patchObject(state, {
        draft: action.draft,
        pendingAttachmentSaveIds: [...state.pendingAttachmentSaveIds, action.saveId],
        suggestions: [],
        suggestSelected: 0,
      });
    case "composer/attachment-save-settled":
      return patchObject(state, {
        ...(action.draft === undefined ? {} : { draft: action.draft }),
        pendingAttachmentSaveIds: state.pendingAttachmentSaveIds.filter((saveId) => saveId !== action.saveId),
      });
    case "composer/draft-set":
      return patchObject(state, {
        draft: action.draft,
        ...(action.clearSuggestions ? { suggestions: [], suggestSelected: 0 } : {}),
        ...(action.resetDismissedSignature ? { suggestionsDismissedSignature: null } : {}),
      });
    case "composer/input-set":
      return setComposerSuggestionsSlice(
        patchObject(state, {
          draft: action.draft,
          suggestionsDismissedSignature: action.dismissedSignature ?? null,
        }),
        action.suggestions,
        action.selected ?? state.suggestSelected,
        action.dismissedSignature ?? null,
      );
    case "composer/suggestions-set":
      return setComposerSuggestionsSlice(
        state,
        action.suggestions,
        action.selected ?? state.suggestSelected,
        action.dismissedSignature === undefined ? state.suggestionsDismissedSignature : action.dismissedSignature,
      );
  }
}

function setComposerSuggestionsSlice(
  state: ChatComposerState,
  suggestions: readonly ComposerSuggestion[],
  selected: number,
  dismissedSignature: string | null,
): ChatComposerState {
  if (
    state.suggestSelected === selected &&
    state.suggestionsDismissedSignature === dismissedSignature &&
    state.suggestions === suggestions
  ) {
    return state;
  }
  return patchObject(state, {
    suggestions,
    suggestSelected: selected,
    suggestionsDismissedSignature: dismissedSignature,
  });
}
