import { ACTIVE_FILE_REFERENCE_NAME, type CodexInput, type CodexInputItem, WEB_CONTEXT_KEY } from "../../../../domain/input/input";
import { userMessageDisplayText } from "../../domain/thread-stream/format/user-message-text";
import type {
  ThreadStreamContextAttachment,
  ThreadStreamFileReference,
  UserThreadStreamDialogueItem,
} from "../../domain/thread-stream/items";
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
  const referencedFiles = fileReferencesFromInput(params.codexInput);
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

function contextAttachmentsFromInput(input: readonly CodexInputItem[]): ThreadStreamContextAttachment[] {
  return input.flatMap((item) => {
    if (item.type !== "additionalContext" || item.key !== WEB_CONTEXT_KEY) return [];
    const source = webContextSource(item.value);
    return [{ label: "Web page", ...(source ? { detail: source } : {}) }];
  });
}

function webContextSource(value: string): string | null {
  const sourceLine = value.split("\n").find((line) => line.startsWith("Source:"));
  const source = sourceLine?.slice("Source:".length).trim() ?? "";
  return source || null;
}

const ACTIVE_FILE_DISPLAY_NAME = "Active file";

function fileReferencesFromInput(input: readonly CodexInputItem[]): ThreadStreamFileReference[] {
  const seenFilePaths = new Set<string>();
  const seenActiveNotePaths = new Set<string>();
  const fileReferences: ThreadStreamFileReference[] = [];
  for (const reference of input) {
    if (reference.type !== "fileReference") continue;
    const activeFileReference = reference.name === ACTIVE_FILE_REFERENCE_NAME;
    const seen = activeFileReference ? seenActiveNotePaths : seenFilePaths;
    if (seen.has(reference.path)) continue;
    seen.add(reference.path);
    fileReferences.push({ name: activeFileReference ? ACTIVE_FILE_DISPLAY_NAME : reference.name, path: reference.path });
  }
  return fileReferences;
}
