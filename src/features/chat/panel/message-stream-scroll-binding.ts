import type { ComposerBoundaryScrollAction } from "../application/composer/boundary-scroll";
import type {
  MessageStreamScrollCommand,
  MessageStreamScrollPort,
  MessageStreamScrollPortBinding,
} from "../ui/message-stream/flow-scroll.measure";

export interface ChatMessageStreamScrollBinding extends MessageStreamScrollPortBinding {
  showLatest(): void;
  scrollFromComposer(action: ComposerBoundaryScrollAction): void;
  dispose(): void;
}

export function createChatMessageStreamScrollBinding(): ChatMessageStreamScrollBinding {
  let scrollPort: MessageStreamScrollPort | null = null;

  const dispatch = (command: MessageStreamScrollCommand): void => {
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
