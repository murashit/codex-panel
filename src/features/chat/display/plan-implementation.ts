import {
  chatTurnBusy,
  type ChatActiveThreadState,
  type ChatComposerState,
  type ChatRuntimeState,
  type ChatTranscriptState,
  type ChatTurnState,
} from "../chat-state";
import type { DisplayItem } from "./types";

export function implementPlanCandidateFromState(state: {
  activeThread: Pick<ChatActiveThreadState, "id">;
  turn: ChatTurnState;
  composer: Pick<ChatComposerState, "draft">;
  runtime: Pick<ChatRuntimeState, "selectedCollaborationMode">;
  transcript: Pick<ChatTranscriptState, "displayItems">;
}): DisplayItem | null {
  if (
    !state.activeThread.id ||
    chatTurnBusy(state) ||
    state.composer.draft.trim().length > 0 ||
    state.runtime.selectedCollaborationMode !== "plan"
  ) {
    return null;
  }
  return (
    [...state.transcript.displayItems].reverse().find((item) => item.kind === "message" && item.messageKind === "proposedPlan") ?? null
  );
}
