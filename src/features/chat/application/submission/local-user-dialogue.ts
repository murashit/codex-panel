import type { CodexInput } from "../../../../domain/input/input";
import { contextAttachmentsFromInput } from "../../domain/thread-stream/format/context-attachments";
import { fileReferencesFromInput } from "../../domain/thread-stream/format/file-references";
import { userMessageDisplayText } from "../../domain/thread-stream/format/user-message-text";
import type { UserThreadStreamDialogueItem } from "../../domain/thread-stream/items";
import { isLocalSteerDialogueClientId } from "../../domain/thread-stream/local-dialogue-ids";
import type { ThreadStreamItemProvenance } from "../../domain/thread-stream/provenance";

export interface LocalUserDialogueFromInputParams {
  id: string;
  clientId?: string;
  interaction?: "prompt" | "steer";
  text: string;
  turnId?: string;
  codexInput: CodexInput;
}

export function localUserDialogueItemFromInput(params: LocalUserDialogueFromInputParams): UserThreadStreamDialogueItem {
  const referencedFiles = fileReferencesFromInput([...params.codexInput]);
  const contextAttachments = contextAttachmentsFromInput(params.codexInput);
  return {
    id: params.id,
    kind: "dialogue",
    dialogueKind: "user",
    role: "user",
    text: userMessageDisplayText(params.text, params.codexInput),
    copyText: params.text,
    provenance: localUserDialogueProvenance(params.clientId ?? params.id, params.interaction),
    ...(params.clientId ? { clientId: params.clientId } : {}),
    ...(params.turnId ? { turnId: params.turnId } : {}),
    ...(referencedFiles.length > 0 ? { referencedFiles } : {}),
    ...(contextAttachments.length > 0 ? { contextAttachments } : {}),
  };
}

function localUserDialogueProvenance(id: string, interaction?: "prompt" | "steer"): ThreadStreamItemProvenance {
  return {
    source: "localUser",
    channel: "optimistic",
    interaction: interaction ?? (isLocalSteerDialogueClientId(id) ? "steer" : "prompt"),
    sourceId: id,
  };
}
