import { describe, expect, it, vi } from "vitest";

import type { ChatShellRenderPort } from "../../../../../src/features/chat/controllers/state-ports";
import { ChatViewRenderController } from "../../../../../src/features/chat/controllers/view/view-render-controller";

describe("ChatViewRenderController", () => {
  it("renders the shell with stable slot delegates", () => {
    const root = {} as HTMLElement;
    const render = vi.fn<ChatShellRenderPort["render"]>();
    const controller = new ChatViewRenderController({
      shell: { render },
      panelRoot: () => root,
      renderToolbar: vi.fn(),
      renderMessages: vi.fn(),
      renderComposer: vi.fn(),
      clearScheduledRender: vi.fn(),
    });

    controller.render();

    expect(render).toHaveBeenCalledWith(
      root,
      0,
      expect.objectContaining({
        renderToolbar: expect.any(Function),
        renderMessages: expect.any(Function),
        renderComposer: expect.any(Function),
      }),
    );
  });

  it("increments the render version when forcing slot rerender", () => {
    const root = {} as HTMLElement;
    const renderVersions: number[] = [];
    const render: ChatShellRenderPort["render"] = vi.fn((_root: HTMLElement, renderVersion: number) => {
      renderVersions.push(renderVersion);
    });
    const controller = new ChatViewRenderController({
      shell: { render },
      panelRoot: () => root,
      renderToolbar: vi.fn(),
      renderMessages: vi.fn(),
      renderComposer: vi.fn(),
      clearScheduledRender: vi.fn(),
    });

    controller.render();
    controller.renderShellSlots();

    expect(renderVersions).toEqual([0, 1]);
  });
});
