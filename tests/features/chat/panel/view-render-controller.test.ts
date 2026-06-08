// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { ChatViewRenderController, type ChatViewRenderControllerHost } from "../../../../src/features/chat/panel/view-render-controller";

describe("ChatViewRenderController", () => {
  it("renders every shell slot without coupling sibling slot layout to message scrolling", () => {
    const root = document.createElement("div");
    const toolbar = document.createElement("div");
    const goal = document.createElement("div");
    const messages = document.createElement("div");
    const composer = document.createElement("div");
    const host = renderHost(root, { toolbar, goal, messages, composer });
    const controller = new ChatViewRenderController(host);

    controller.render();

    expect(host.renderToolbar).toHaveBeenCalledWith(toolbar);
    expect(host.renderGoal).toHaveBeenCalledWith(goal);
    expect(host.renderMessages).toHaveBeenCalledWith(messages);
    expect(host.renderComposer).toHaveBeenCalledWith(composer);
  });
});

function renderHost(
  root: HTMLElement,
  slots: {
    toolbar: HTMLElement;
    goal: HTMLElement;
    messages: HTMLElement;
    composer: HTMLElement;
  },
): ChatViewRenderControllerHost {
  return {
    shell: {
      render: (_root, _renderVersion, renderers) => {
        renderers.renderToolbar(slots.toolbar);
        renderers.renderGoal(slots.goal);
        renderers.renderMessages(slots.messages);
        renderers.renderComposer(slots.composer);
      },
    },
    panelRoot: () => root,
    renderToolbar: vi.fn(),
    renderGoal: vi.fn(),
    renderMessages: vi.fn(),
    renderComposer: vi.fn(),
    clearScheduledRender: vi.fn(),
  };
}
