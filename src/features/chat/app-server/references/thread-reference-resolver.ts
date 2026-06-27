import { readReferencedThreadConversationSummaries, type ThreadConversationSummaryClient } from "../../../../app-server/threads";
import { type CodexInput, codexTextInputWithAttachments } from "../../../../domain/chat/input";
import type { Thread } from "../../../../domain/threads/model";
import { REFERENCED_THREAD_TURN_LIMIT, referencedThreadPromptBundle } from "../../../../domain/threads/reference";
import { shortThreadId } from "../../../../shared/id/thread-id";
import type { ThreadReferenceInput } from "../../application/conversation/slash-command-execution";

interface ThreadReferenceResolverHost {
  currentClient(): ThreadConversationSummaryClient | null;
  codexInput(text: string): CodexInput;
  addSystemMessage(text: string): void;
  setStatus(status: string): void;
}

export interface ThreadReferenceResolver {
  referThread(thread: Thread, message: string): Promise<ThreadReferenceInput | null>;
}

export function createThreadReferenceResolver(host: ThreadReferenceResolverHost): ThreadReferenceResolver {
  return {
    referThread: (thread, message) => referencedThreadInput(host, thread, message),
  };
}

async function referencedThreadInput(
  host: ThreadReferenceResolverHost,
  thread: Thread,
  message: string,
): Promise<ThreadReferenceInput | null> {
  const client = host.currentClient();
  if (!client) return null;
  try {
    const turns = await readReferencedThreadConversationSummaries(client, thread.id, REFERENCED_THREAD_TURN_LIMIT);
    if (host.currentClient() !== client) return null;
    if (turns.length === 0) {
      host.addSystemMessage("Referenced thread has no readable conversation turns.");
      return null;
    }
    const reference = referencedThreadPromptBundle(thread, turns, message);
    const messageInput = host.codexInput(message);
    host.setStatus(`Referencing ${shortThreadId(thread.id)} (${String(turns.length)}/${String(REFERENCED_THREAD_TURN_LIMIT)} turns).`);
    return {
      input: codexTextInputWithAttachments(reference.prompt, messageInput),
      referencedThread: reference.referencedThread,
    };
  } catch (error) {
    if (host.currentClient() !== client) return null;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return null;
  }
}
