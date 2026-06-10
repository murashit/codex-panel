// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { ChatViewRenderController, type ChatViewRenderControllerHost } from "../../../../src/features/chat/panel/view-render-controller";

describe("ChatViewRenderController", () => {
  it("renders the shell through the configured panel root", () => {
    const root = document.createElement("div");
    const renderShell = vi.fn();
    const host = renderHost(root, renderShell);
    const controller = new ChatViewRenderController(host);

    controller.render();

    expect(host.clearScheduledRender).toHaveBeenCalledOnce();
    expect(renderShell).toHaveBeenCalledWith(root);
  });
});

function renderHost(root: HTMLElement, renderShell: (root: HTMLElement) => void): ChatViewRenderControllerHost {
  return {
    shell: {
      render: renderShell,
    },
    panelRoot: () => root,
    clearScheduledRender: vi.fn(),
  };
}
