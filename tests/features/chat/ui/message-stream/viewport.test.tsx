// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";

import { MessageStreamViewport } from "../../../../../src/features/chat/ui/message-stream/viewport";
import type { MessageStreamBlock } from "../../../../../src/features/chat/ui/message-stream/context";
import { renderUiRoot } from "../../../../../src/shared/ui/ui-root";
import { unmountUiRootInAct } from "./test-helpers";
import type { MessageStreamScrollIntent } from "../../../../../src/features/chat/ui/message-stream/virtualizer";

describe("message stream viewport fallback rendering", () => {
  it("starts fallback rendering near the current top scroll offset", () => {
    const parent = renderViewport(messageBlocks(40), 0);

    expect(blockHosts(parent)[0]).toMatchObject({ index: "0", key: "block-0", transform: "translateY(0px)" });
    unmountUiRootInAct(parent);
  });

  it("centers fallback rendering around the estimated scroll offset", () => {
    const parent = renderViewport(messageBlocks(80), 96 * 40);

    expect(blockHosts(parent)[0]).toMatchObject({ index: "24", key: "block-24", transform: "translateY(2304px)" });
    expect(blockHosts(parent)).toHaveLength(32);
    unmountUiRootInAct(parent);
  });

  it("clamps negative fallback scroll offsets to the first block", () => {
    const parent = renderViewport(messageBlocks(40), -96);

    expect(blockHosts(parent)[0]).toMatchObject({ index: "0", key: "block-0", transform: "translateY(0px)" });
    expect(blockHosts(parent)).toHaveLength(32);
    unmountUiRootInAct(parent);
  });

  it("clamps fallback rendering to the last full window near the end", () => {
    const parent = renderViewport(messageBlocks(80), 96 * 10_000);
    const hosts = blockHosts(parent);

    expect(hosts[0]).toMatchObject({ index: "48", key: "block-48", transform: "translateY(4608px)" });
    expect(hosts.at(-1)).toMatchObject({ index: "79", key: "block-79", transform: "translateY(7584px)" });
    expect(hosts).toHaveLength(32);
    unmountUiRootInAct(parent);
  });
});

function renderViewport(blocks: MessageStreamBlock[], scrollTop: number): HTMLElement {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  renderUiRootInAct(
    parent,
    h(MessageStreamViewport, {
      state: {
        blocks,
        consumeScrollIntent: consumePreserveScrollIntent,
      },
    }),
  );
  const viewport = parent.querySelector<HTMLElement>(".codex-panel__messages");
  if (!viewport) throw new Error("Expected message stream viewport");
  Object.defineProperty(viewport, "scrollTop", { value: scrollTop, configurable: true });
  renderUiRootInAct(
    parent,
    h(MessageStreamViewport, {
      state: {
        blocks,
        consumeScrollIntent: consumePreserveScrollIntent,
      },
    }),
  );
  return parent;
}

function renderUiRootInAct(parent: HTMLElement, node: Parameters<typeof renderUiRoot>[1]): void {
  void act(() => {
    renderUiRoot(parent, node);
  });
}

function consumePreserveScrollIntent(): MessageStreamScrollIntent {
  return "preserve";
}

function blockHosts(parent: HTMLElement): { index: string | null; key: string | null; transform: string }[] {
  return Array.from(parent.querySelectorAll<HTMLElement>(".codex-panel__message-block")).map((element) => ({
    index: element.getAttribute("data-index"),
    key: element.getAttribute("data-codex-panel-block-key"),
    transform: element.style.transform,
  }));
}

function messageBlocks(count: number): MessageStreamBlock[] {
  return Array.from({ length: count }, (_, index) => ({ key: `block-${String(index)}`, node: null }));
}
