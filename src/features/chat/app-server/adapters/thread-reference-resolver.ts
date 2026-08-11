import type { AppServerRequestClient } from "../../../../app-server/services/request-client";
import { readReferencedThreadTranscriptPage } from "../../../../app-server/services/threads";
import { threadReferenceMarkdown } from "../../../../domain/threads/deep-link";
import { shortThreadId } from "../../../../domain/threads/id";
import type { Thread } from "../../../../domain/threads/model";
import { REFERENCED_THREAD_TURN_LIMIT, referencedThreadContext } from "../../../../domain/threads/reference";
import { codexTextInputWithAttachments } from "../../../../domain/turns/input";
import type { ComposerInputSnapshot } from "../../application/composer/input-snapshot";
import type { PreparedInput } from "../../application/composer/prepared-input";

interface ThreadReferenceResolverHost {
  currentClient(): AppServerRequestClient | null;
  prepareInput(text: string, snapshot: ComposerInputSnapshot): PreparedInput;
  addSystemMessage(text: string): void;
  setStatus(status: string): void;
}

export type ThreadReferenceResolver = (thread: Thread, message: string, snapshot: ComposerInputSnapshot) => Promise<PreparedInput | null>;

export function createThreadReferenceResolver(host: ThreadReferenceResolverHost): ThreadReferenceResolver {
  return (thread, message, snapshot) => referencedThreadInput(host, thread, message, snapshot);
}

async function referencedThreadInput(
  host: ThreadReferenceResolverHost,
  thread: Thread,
  message: string,
  snapshot: ComposerInputSnapshot,
): Promise<PreparedInput | null> {
  const client = host.currentClient();
  if (!client) return null;
  try {
    const transcript = await readReferencedThreadTranscriptPage(client, thread.id, REFERENCED_THREAD_TURN_LIMIT);
    if (transcript.turns.length === 0) {
      host.addSystemMessage("Referenced thread has no readable turns.");
      return null;
    }
    const messageInput = host.prepareInput(message, snapshot);
    const reference = referencedThreadContext(thread, transcript);
    const visibleText = `${threadReferenceMarkdown(thread)}\n\n${messageInput.text}`;
    host.setStatus(
      `Referencing ${shortThreadId(thread.id)} (${String(transcript.turns.length)}/${String(REFERENCED_THREAD_TURN_LIMIT)} turns).`,
    );
    return {
      text: visibleText,
      input: codexTextInputWithAttachments(visibleText, [
        {
          type: "additionalContext",
          key: "codex_panel_referenced_thread",
          kind: "untrusted",
          value: reference,
        },
        ...messageInput.input,
      ]),
    };
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return null;
  }
}
