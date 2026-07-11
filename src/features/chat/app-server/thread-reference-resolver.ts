import type { AppServerRequestClient } from "../../../app-server/services/request-client";
import { readReferencedThreadTurnTranscriptSummaries } from "../../../app-server/services/threads";
import { type CodexInput, codexTextInputWithAttachments } from "../../../domain/chat/input";
import { shortThreadId } from "../../../domain/threads/id";
import type { Thread } from "../../../domain/threads/model";
import { REFERENCED_THREAD_TURN_LIMIT, referencedThreadPromptBundle } from "../../../domain/threads/reference";
import type { ComposerInputSnapshot } from "../application/composer/input-snapshot";
import type { ThreadReferenceInput } from "../application/turns/slash-command-execution";

interface ThreadReferenceResolverHost {
  currentClient(): AppServerRequestClient | null;
  prepareInput(text: string, snapshot: ComposerInputSnapshot): { text: string; input: CodexInput };
  addSystemMessage(text: string): void;
  setStatus(status: string): void;
}

export interface ThreadReferenceResolver {
  referThread(thread: Thread, message: string, snapshot: ComposerInputSnapshot): Promise<ThreadReferenceInput | null>;
}

export function createThreadReferenceResolver(host: ThreadReferenceResolverHost): ThreadReferenceResolver {
  return {
    referThread: (thread, message, snapshot) => referencedThreadInput(host, thread, message, snapshot),
  };
}

async function referencedThreadInput(
  host: ThreadReferenceResolverHost,
  thread: Thread,
  message: string,
  snapshot: ComposerInputSnapshot,
): Promise<ThreadReferenceInput | null> {
  const client = host.currentClient();
  if (!client) return null;
  try {
    const turns = await readReferencedThreadTurnTranscriptSummaries(client, thread.id, REFERENCED_THREAD_TURN_LIMIT);
    if (host.currentClient() !== client) return null;
    if (turns.length === 0) {
      host.addSystemMessage("Referenced thread has no readable turns.");
      return null;
    }
    const messageInput = host.prepareInput(message, snapshot);
    const reference = referencedThreadPromptBundle(thread, turns, messageInput.text);
    host.setStatus(`Referencing ${shortThreadId(thread.id)} (${String(turns.length)}/${String(REFERENCED_THREAD_TURN_LIMIT)} turns).`);
    return {
      text: messageInput.text,
      input: codexTextInputWithAttachments(reference.prompt, messageInput.input),
      referencedThread: reference.referencedThread,
    };
  } catch (error) {
    if (host.currentClient() !== client) return null;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return null;
  }
}
