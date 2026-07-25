import { describe, expect, it, vi } from "vitest";

import { createChatThreadStreamScrollBinding } from "../../../../../src/features/chat/panel/thread-stream/scroll-binding";
import type { ThreadStreamScrollPort } from "../../../../../src/features/chat/ui/thread-stream/flow-scroll.measure";

describe("chat thread stream scroll binding", () => {
  it("forwards panel and composer commands to the mounted scroll port", () => {
    const binding = createChatThreadStreamScrollBinding();
    const dispatchScrollCommand = vi.fn<ThreadStreamScrollPort["dispatchScrollCommand"]>();

    binding.showLatest();
    binding.scrollFromComposer({ kind: "scroll-to", edge: "start" });
    expect(dispatchScrollCommand).not.toHaveBeenCalled();

    binding.mountScrollPort({ dispatchScrollCommand });
    binding.showLatest();
    binding.scrollFromComposer({ kind: "scroll-by", direction: -1, amount: "page" });

    expect(dispatchScrollCommand.mock.calls).toEqual([[{ kind: "show-latest" }], [{ kind: "scroll-by", direction: -1, amount: "page" }]]);
  });

  it("keeps the newest port mounted and stops forwarding after unmount or disposal", () => {
    const binding = createChatThreadStreamScrollBinding();
    const first = vi.fn<ThreadStreamScrollPort["dispatchScrollCommand"]>();
    const second = vi.fn<ThreadStreamScrollPort["dispatchScrollCommand"]>();
    const unmountFirst = binding.mountScrollPort({ dispatchScrollCommand: first });
    const unmountSecond = binding.mountScrollPort({ dispatchScrollCommand: second });

    unmountFirst();
    binding.showLatest();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ kind: "show-latest" });

    unmountSecond();
    binding.showLatest();
    expect(second).toHaveBeenCalledOnce();

    binding.mountScrollPort({ dispatchScrollCommand: second });
    binding.dispose();
    binding.showLatest();
    expect(second).toHaveBeenCalledOnce();
  });
});
