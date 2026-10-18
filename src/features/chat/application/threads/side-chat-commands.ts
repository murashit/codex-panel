import type { ThreadActivationSnapshot } from "../../../../domain/threads/model";
import type { EffectOutcome } from "../effect-outcome";
import { activeThreadState } from "../state/model";
import type { ChatStateStore } from "../state/store";
import type { ThreadForkRuntimeOverrides } from "./fork-draft";

export interface SideChatPort {
  forkEphemeralThread(
    sourceThreadId: string,
    runtime: ThreadForkRuntimeOverrides,
    isCurrent: () => boolean,
  ): Promise<ThreadActivationSnapshot | null>;
  release(): Promise<void>;
  dispose(): Promise<void>;
}

export interface SideChatCommands {
  create(
    sourceThreadId: string,
    runtime: ThreadForkRuntimeOverrides,
    isCurrent: () => boolean,
  ): Promise<EffectOutcome<ThreadActivationSnapshot>>;
  prepareForNavigation(): void;
  cleanupForConnectionReset(): void;
  dispose(): void;
}

interface SideChatCommandsHost {
  stateStore: ChatStateStore;
  effects: SideChatPort;
  notifyActiveThreadIdentityChanged(): void;
}

export function createSideChatCommands(host: SideChatCommandsHost): SideChatCommands {
  // The adapter owns the conversation; this layer only retires its presentation.
  const release = (): void => {
    void host.effects.release().catch(() => undefined);
  };
  return {
    async create(sourceThreadId, runtime, isCurrent) {
      const activation = await host.effects.forkEphemeralThread(sourceThreadId, runtime, isCurrent);
      return activation ? { kind: "completed", value: activation } : { kind: "not-started" };
    },
    prepareForNavigation() {
      const thread = activeThreadState(host.stateStore.getState());
      release();
      if (thread?.lifetime?.kind === "ephemeral") {
        host.stateStore.dispatch({ type: "active-thread/cleared" });
        host.notifyActiveThreadIdentityChanged();
      }
    },
    cleanupForConnectionReset() {
      release();
    },
    dispose() {
      void host.effects.dispose().catch(() => undefined);
    },
  };
}
