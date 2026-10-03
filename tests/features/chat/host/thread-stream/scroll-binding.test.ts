import { describe, expect, it, vi } from "vitest";

import { createChatThreadStreamScrollBinding } from "../../../../../src/features/chat/host/thread-stream/scroll-binding";
import type { ThreadStreamScrollPort } from "../../../../../src/features/chat/ui/thread-stream/flow-scroll";

describe("chat thread stream scroll binding", () => {
  it("keeps the newest port mounted and stops forwarding after unmount or disposal", () => {
    const binding = createChatThreadStreamScrollBinding();
    const first = vi.fn<ThreadStreamScrollPort["dispatchScrollCommand"]>();
    const second = vi.fn<ThreadStreamScrollPort["dispatchScrollCommand"]>();
    binding.showLatest();
    binding.scrollFromComposer({ kind: "scroll-to", edge: "start" });
    expect(first).not.toHaveBeenCalled();

    const unmountFirst = binding.mountScrollPort({ dispatchScrollCommand: first });
    const unmountSecond = binding.mountScrollPort({ dispatchScrollCommand: second });

    unmountFirst();
    binding.showLatest();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ kind: "show-latest" });
    binding.scrollFromComposer({ kind: "scroll-by", direction: -1, amount: "page" });
    expect(second).toHaveBeenLastCalledWith({ kind: "scroll-by", direction: -1, amount: "page" });

    unmountSecond();
    binding.showLatest();
    expect(second).toHaveBeenCalledTimes(2);

    binding.mountScrollPort({ dispatchScrollCommand: second });
    binding.dispose();
    binding.showLatest();
    expect(second).toHaveBeenCalledTimes(2);
  });
});
