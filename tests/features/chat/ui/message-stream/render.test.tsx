// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { messageStreamVirtualItems } from "../../../../../src/features/chat/ui/message-stream/render";
import type { MessageStreamBlock } from "../../../../../src/features/chat/ui/message-stream/context";

describe("message stream virtual item fallback", () => {
  it("starts fallback rendering near the current top scroll offset", () => {
    const items = messageStreamVirtualItems([], messageBlocks(40), 0);

    expect(items[0]).toMatchObject({ index: 0, key: "block-0", start: 0 });
  });

  it("centers fallback rendering around the estimated scroll offset", () => {
    const items = messageStreamVirtualItems([], messageBlocks(80), 96 * 40);

    expect(items[0]).toMatchObject({ index: 24, key: "block-24", start: 96 * 24 });
    expect(items).toHaveLength(32);
  });

  it("uses virtualizer items when TanStack has produced a range", () => {
    const virtualItems = [{ index: 12, key: "virtual", start: 1234 }];

    expect(messageStreamVirtualItems(virtualItems, messageBlocks(80), 0)).toBe(virtualItems);
  });
});

function messageBlocks(count: number): MessageStreamBlock[] {
  return Array.from({ length: count }, (_, index) => ({ key: `block-${String(index)}`, node: null }));
}
