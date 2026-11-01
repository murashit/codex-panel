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
      type: "composer/draft-set";
      draft: string;
      clearSuggestions?: boolean;
      pendingAttachmentSaveIds?: readonly number[];
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
    case "composer/draft-set":
      return patchObject(state, {
        draft: action.draft,
        ...(action.pendingAttachmentSaveIds === undefined ? {} : { pendingAttachmentSaveIds: action.pendingAttachmentSaveIds }),
        ...(action.clearSuggestions ? { suggestions: [], suggestSelected: 0 } : {}),
      });
    case "composer/input-set":
      return patchObject(state, {
        draft: action.draft,
        suggestions: action.suggestions,
        suggestSelected: action.selected ?? state.suggestSelected,
        suggestionsDismissedSignature: action.dismissedSignature ?? null,
      });
    case "composer/suggestions-set":
      return patchObject(state, {
        suggestions: action.suggestions,
        suggestSelected: action.selected ?? state.suggestSelected,
        suggestionsDismissedSignature:
          action.dismissedSignature === undefined ? state.suggestionsDismissedSignature : action.dismissedSignature,
      });
  }
}
