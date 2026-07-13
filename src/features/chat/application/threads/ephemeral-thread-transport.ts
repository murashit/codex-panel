import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";

type EphemeralThreadForkResult =
  | { kind: "ready"; activation: ThreadActivationSnapshot; sourceThreadId: string }
  | { kind: "cleanup-required"; threadId: string };

export interface EphemeralThreadTransport {
  forkEphemeralThread(sourceThreadId: string): Promise<EphemeralThreadForkResult | null>;
  unsubscribeEphemeralThread(threadId: string): Promise<boolean>;
}
