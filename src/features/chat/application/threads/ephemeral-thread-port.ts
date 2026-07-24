import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import type { EffectOutcome } from "../effect-outcome";

export type EphemeralThreadForkResult =
  | { kind: "ready"; activation: ThreadActivationSnapshot; sourceThreadId: string }
  | { kind: "cleanup-required"; threadId: string };

export interface EphemeralThreadPort {
  forkEphemeralThread(sourceThreadId: string): Promise<EffectOutcome<EphemeralThreadForkResult>>;
  unsubscribeEphemeralThread(threadId: string): Promise<boolean>;
}
