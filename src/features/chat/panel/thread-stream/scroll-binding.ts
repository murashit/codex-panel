import type { ComposerBoundaryScrollAction } from "../../application/composer/boundary-scroll";
import type {
  ThreadStreamScrollCommand,
  ThreadStreamScrollPort,
  ThreadStreamScrollPortBinding,
} from "../../ui/thread-stream/flow-scroll.measure";

export interface ChatThreadStreamScrollBinding extends ThreadStreamScrollPortBinding {
  showLatest(): void;
  scrollFromComposer(action: ComposerBoundaryScrollAction): void;
  dispose(): void;
}

export function createChatThreadStreamScrollBinding(): ChatThreadStreamScrollBinding {
  let scrollPort: ThreadStreamScrollPort | null = null;

  const dispatch = (command: ThreadStreamScrollCommand): void => {
    scrollPort?.dispatchScrollCommand(command);
  };

  return {
    mountScrollPort(port): () => void {
      scrollPort = port;
      return () => {
        if (scrollPort === port) scrollPort = null;
      };
    },

    showLatest(): void {
      dispatch({ kind: "show-latest" });
    },

    scrollFromComposer(action): void {
      dispatch(action);
    },

    dispose(): void {
      scrollPort = null;
    },
  };
}
