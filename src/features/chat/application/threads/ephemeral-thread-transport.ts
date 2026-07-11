import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";

export interface EphemeralThreadTransport {
  forkEphemeralThread(sourceThreadId: string): Promise<{ activation: ThreadActivationSnapshot; sourceThreadId: string } | null>;
  deleteEphemeralThread(threadId: string): Promise<boolean>;
}
