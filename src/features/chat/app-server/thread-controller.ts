import type { AppServerClient } from "../../../app-server/client";
import { upsertThread } from "../../../domain/threads/model";
import type { Thread } from "../../../generated/app-server/v2/Thread";
import { requestedOrConfiguredServiceTier, type RuntimeSnapshot } from "../../../runtime/state";
import { resumedThreadAction } from "../thread-resume";
import type { ChatAppServerBaseHost } from "./shared";
import { chatAppServerState, dispatchChatAppServerAction } from "./shared";

export interface ChatAppServerThreadControllerHost extends ChatAppServerBaseHost {
  runtimeSnapshot: () => RuntimeSnapshot;
  forceMessagesToBottom: () => void;
  publishThreadList: (threads: readonly Thread[]) => void;
  syncThreadGoal: (threadId: string) => void;
}

export class ChatAppServerThreadController {
  constructor(private readonly host: ChatAppServerThreadControllerHost) {}

  applyThreadList(threads: readonly Thread[]): void {
    dispatchChatAppServerAction(this.host, { type: "thread-list/applied", threads, threadsLoaded: true });
  }

  async loadThreadList(): Promise<readonly Thread[]> {
    const client = this.host.currentClient();
    if (!client) throw new Error("Codex app-server is not connected.");
    const response = await client.listThreads(this.host.vaultPath);
    return response.data;
  }

  async startThread(
    preview?: string,
    options: { syncGoal?: boolean } = {},
  ): Promise<Awaited<ReturnType<AppServerClient["startThread"]>> | null> {
    const client = this.host.currentClient();
    if (!client) return null;
    const serviceTier = requestedOrConfiguredServiceTier(this.host.runtimeSnapshot());
    const response = await client.startThread(this.host.vaultPath, serviceTier);
    const state = chatAppServerState(this.host);
    const listedThreads = upsertThread(state.threadList.listedThreads, threadWithPreviewFallback(response.thread, preview));
    dispatchChatAppServerAction(this.host, resumedThreadAction({ response, listedThreads, forceMessagesToBottom: true }));
    this.host.publishThreadList(listedThreads);
    this.host.forceMessagesToBottom();
    if (options.syncGoal ?? true) this.host.syncThreadGoal(response.thread.id);
    return response;
  }
}

function threadWithPreviewFallback(thread: Thread, preview: string | undefined): Thread {
  if (thread.preview.trim().length > 0) return thread;
  const fallback = preview?.trim();
  return fallback ? { ...thread, preview: fallback } : thread;
}
