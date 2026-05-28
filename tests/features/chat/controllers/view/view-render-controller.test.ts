// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../../../src/features/chat/chat-state";
import { ChatViewRenderController } from "../../../../../src/features/chat/controllers/view/view-render-controller";
import { renderChatPanelShell } from "../../../../../src/features/chat/ui/shell";

vi.mock("../../../../../src/features/chat/ui/shell", () => ({
  renderChatPanelShell: vi.fn(),
}));

describe("ChatViewRenderController", () => {
  beforeEach(() => {
    vi.mocked(renderChatPanelShell).mockClear();
  });

  it("renders the shell with stable slot delegates", () => {
    const root = document.createElement("div");
    const controller = new ChatViewRenderController({
      stateStore: createChatStateStore(createChatState()),
      panelRoot: () => root,
      connected: () => true,
      pendingRequestsSignature: () => "",
      activeComposerThreadName: () => null,
      renderToolbar: vi.fn(),
      renderMessages: vi.fn(),
      renderComposer: vi.fn(),
      clearScheduledRender: vi.fn(),
    });

    controller.render();

    expect(renderChatPanelShell).toHaveBeenCalledWith(
      root,
      expect.objectContaining({
        renderVersion: 0,
        toolbar: expect.objectContaining({ render: expect.any(Function), snapshot: expect.any(Function) }),
        messages: expect.objectContaining({ render: expect.any(Function), snapshot: expect.any(Function) }),
        composer: expect.objectContaining({ render: expect.any(Function), snapshot: expect.any(Function) }),
      }),
    );
  });

  it("increments the render version when forcing slot rerender", () => {
    const root = document.createElement("div");
    const controller = new ChatViewRenderController({
      stateStore: createChatStateStore(createChatState()),
      panelRoot: () => root,
      connected: () => true,
      pendingRequestsSignature: () => "",
      activeComposerThreadName: () => null,
      renderToolbar: vi.fn(),
      renderMessages: vi.fn(),
      renderComposer: vi.fn(),
      clearScheduledRender: vi.fn(),
    });

    controller.render();
    controller.renderShellSlots();

    expect(vi.mocked(renderChatPanelShell).mock.calls.map(([, model]) => model.renderVersion)).toEqual([0, 1]);
  });
});
