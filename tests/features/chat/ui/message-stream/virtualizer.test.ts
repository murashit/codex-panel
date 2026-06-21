// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { h } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { act } from "preact/test-utils";

import {
  type MessageStreamScrollCommand,
  type MessageStreamScrollControllerBinding,
  type MessageStreamScrollPort,
  type MessageStreamVirtualizerView,
  useMessageStreamVirtualizer,
} from "../../../../../src/features/chat/ui/message-stream/virtualizer";
import type { MessageStreamBlock } from "../../../../../src/features/chat/ui/message-stream/context";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/ui-root";
import { installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();

type TestMessageStreamScrollRequest = "auto" | "show-latest";

describe("TestMessageStreamVirtualizer", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("pins to the virtualized end when content is appended while pinned", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first"], [180], "show-latest");
    expect(container.scrollTop).toBe(80);

    renderVirtualItems(controller, container, ["first", "second"], [180, 220], "auto");

    expect(container.scrollTop).toBe(300);
    controller.dispose();
  });

  it("requests the end before measurements and remains there after measurements resolve", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);
    const blocks = [{ key: "first", node: null }];
    container.dataset["testTotalSize"] = "180";

    controller.render(blocks, "show-latest");
    expect(container.scrollTop).toBe(80);

    measureVirtualItem(controller, "first", 0, 180);

    expect(controller.getTotalSize()).toBe(180);
    expect(container.scrollTop).toBe(80);
    controller.dispose();
  });

  it("keeps the latest message visible until the rendered virtualizer height reaches the DOM", () => {
    withAnimationFrame((flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);
      const blocks = [{ key: "first", node: null }];
      container.dataset["testTotalSize"] = "180";
      container.dataset["testScrollHeight"] = "100";
      container.dataset["testClampToScrollHeight"] = "true";

      controller.render(blocks, "show-latest");
      expect(container.scrollTop).toBe(0);

      flushFrames();

      delete container.dataset["testScrollHeight"];
      flushFrames();

      expect(container.scrollTop).toBe(80);
      controller.dispose();
    });
  });

  it("reaches the latest message after delayed rendered virtualizer height catches up", () => {
    withAnimationFrame((flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);
      const blocks = [{ key: "first", node: null }];
      container.dataset["testTotalSize"] = "180";
      container.dataset["testScrollHeight"] = "100";
      container.dataset["testClampToScrollHeight"] = "true";

      controller.render(blocks, "show-latest");
      expect(container.scrollTop).toBe(0);

      flushFrames();

      flushFrames();

      delete container.dataset["testScrollHeight"];
      flushFrames();

      expect(container.scrollTop).toBe(80);
      controller.dispose();
    });
  });

  it("includes message container block padding in the virtualized end", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    container.style.paddingLeft = "12px";
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first"], [180], "show-latest");

    expect(controller.getTotalSize()).toBe(204);
    expect(container.scrollTop).toBe(104);
    controller.dispose();
  });

  it("does not follow appended content after the user scrolls away from the end", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first"], [300], "show-latest");
    expect(container.scrollTop).toBe(200);

    userScrollTo(container, 80);

    renderVirtualItems(controller, container, ["first", "second"], [300, 180], "auto");

    expect(container.scrollTop).toBe(80);
    controller.dispose();
  });

  it("repins when the user scrolls back to the end", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first", "second"], [300, 180], "show-latest");
    expect(container.scrollTop).toBe(380);

    userScrollTo(container, 80);

    userScrollTo(container, 380);

    renderVirtualItems(controller, container, ["first", "second", "third"], [300, 180, 140], "auto");

    expect(container.scrollTop).toBe(520);
    controller.dispose();
  });

  it("keeps forced bottom pinned when the programmatic scroll event sees stale DOM scroll size", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first", "submitted"], [300, 100], "show-latest");
    expect(container.scrollTop).toBe(300);

    container.dataset["testScrollHeight"] = "420";
    container.dispatchEvent(new Event("scroll"));

    delete container.dataset["testScrollHeight"];
    renderVirtualItems(controller, container, ["first", "submitted", "reply"], [300, 100, 100], "auto");

    expect(container.scrollTop).toBe(400);
    controller.dispose();
  });

  it("keeps pinned intent when a programmatic scroll event observes a stale non-bottom offset", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first"], [300], "show-latest");
    expect(container.scrollTop).toBe(200);

    container.dataset["testTotalSize"] = "450";
    container.dispatchEvent(new Event("scroll"));

    renderVirtualItems(controller, container, ["first", "second"], [300, 150], "auto");

    expect(container.scrollTop).toBe(350);
    controller.dispose();
  });

  it("keeps following the end when a pinned item grows after measurement", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first", "command"], [200, 100], "show-latest");
    expect(container.scrollTop).toBe(200);

    container.dataset["testTotalSize"] = "450";
    measureVirtualItem(controller, "command", 1, 250);

    expect(container.scrollTop).toBe(350);
    controller.dispose();
  });

  it("keeps the latest message visible when pinned content grows before DOM scroll height catches up", () => {
    withAnimationFrame((flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);

      renderVirtualItems(controller, container, ["first", "command"], [200, 100], "show-latest");
      flushFrames();
      flushFrames();
      expect(container.scrollTop).toBe(200);

      container.dataset["testTotalSize"] = "450";
      container.dataset["testScrollHeight"] = "300";
      container.dataset["testClampToScrollHeight"] = "true";
      measureVirtualItem(controller, "command", 1, 250);

      expect(container.scrollTop).toBe(200);

      flushFrames();

      delete container.dataset["testScrollHeight"];
      flushFrames();

      expect(container.scrollTop).toBe(350);
      controller.dispose();
    });
  });

  it("keeps following the end when pinned content grows in the DOM before measurement", () => {
    withAnimationFrame((flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);

      renderVirtualItems(controller, container, ["first", "markdown"], [200, 100], "show-latest");
      flushFrames();
      flushFrames();
      expect(container.scrollTop).toBe(200);

      container.dataset["testScrollHeight"] = "461";
      container.dataset["testClampToScrollHeight"] = "true";
      container.dataset["testTotalSize"] = "450";
      measureVirtualItem(controller, "markdown", 1, 250);

      expect(container.scrollTop).toBe(361);

      delete container.dataset["testScrollHeight"];
      flushFrames();

      expect(container.scrollTop).toBe(350);
      controller.dispose();
    });
  });

  it("keeps following the end when a non-last rendered message grows while pinned", () => {
    withAnimationFrame((flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);

      renderVirtualItems(controller, container, ["first", "markdown", "live"], [160, 100, 80], "show-latest");
      flushFrames();
      flushFrames();
      expect(container.scrollTop).toBe(240);

      container.dataset["testScrollHeight"] = "500";
      container.dataset["testClampToScrollHeight"] = "true";
      container.dataset["testTotalSize"] = "500";
      measureVirtualItem(controller, "markdown", 1, 260);

      expect(container.scrollTop).toBe(400);
      controller.dispose();
    });
  });

  it("does not jump away from the latest message when a stale programmatic scroll event fires during pinned growth", () => {
    withAnimationFrame((flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);

      renderVirtualItems(controller, container, ["first", "command"], [200, 100], "show-latest");
      flushFrames();
      flushFrames();
      expect(container.scrollTop).toBe(200);

      container.dataset["testTotalSize"] = "450";
      container.dataset["testScrollHeight"] = "300";
      container.dataset["testClampToScrollHeight"] = "true";
      measureVirtualItem(controller, "command", 1, 250);
      container.dispatchEvent(new Event("scroll"));

      delete container.dataset["testScrollHeight"];
      flushFrames();
      flushFrames();

      expect(container.scrollTop).toBe(350);
      controller.dispose();
    });
  });

  it("still reaches the latest message when small pinned growth measurements keep arriving", () => {
    withAnimationFrame((flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);

      renderVirtualItems(controller, container, ["first", "command"], [200, 100], "show-latest");
      flushFrames();
      flushFrames();
      expect(container.scrollTop).toBe(200);

      container.dataset["testScrollHeight"] = "300";
      container.dataset["testClampToScrollHeight"] = "true";

      container.dataset["testTotalSize"] = "320";
      measureVirtualItem(controller, "command", 1, 120);
      flushFrames();

      container.dataset["testTotalSize"] = "340";
      measureVirtualItem(controller, "command", 1, 140);
      delete container.dataset["testScrollHeight"];
      flushFrames();

      expect(container.scrollTop).toBe(240);
      controller.dispose();
    });
  });

  it("keeps the latest message visible when ResizeObserver reports pinned growth before DOM scroll height catches up", () => {
    withResizeObserverEntries((resizeElement, flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);
      const command = measuredElement("command", 1, 100);

      container.dataset["testTotalSize"] = "300";
      controller.render(
        [
          { key: "first", node: null },
          { key: "command", node: null },
        ],
        "show-latest",
      );
      controller.getTotalSize();
      measureVirtualItem(controller, "first", 0, 200);
      controller.measureElement(command);
      flushFrames();
      flushFrames();
      expect(container.scrollTop).toBe(200);

      container.dataset["testTotalSize"] = "450";
      container.dataset["testScrollHeight"] = "300";
      container.dataset["testClampToScrollHeight"] = "true";
      resizeElement(command, 250);

      flushFrames();
      expect(container.scrollTop).toBe(200);

      flushFrames();
      expect(container.scrollTop).toBe(200);

      delete container.dataset["testScrollHeight"];
      flushFrames();

      expect(container.scrollTop).toBe(350);
      controller.dispose();
    });
  });

  it("still reaches the latest message while ResizeObserver keeps reporting small pinned growth", () => {
    withResizeObserverEntries((resizeElement, flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);
      const command = measuredElement("command", 1, 100);

      container.dataset["testTotalSize"] = "300";
      controller.render(
        [
          { key: "first", node: null },
          { key: "command", node: null },
        ],
        "show-latest",
      );
      controller.getTotalSize();
      measureVirtualItem(controller, "first", 0, 200);
      controller.measureElement(command);
      flushFrames();
      flushFrames();
      expect(container.scrollTop).toBe(200);

      container.dataset["testScrollHeight"] = "300";
      container.dataset["testClampToScrollHeight"] = "true";

      container.dataset["testTotalSize"] = "320";
      resizeElement(command, 120);
      flushFrames();

      container.dataset["testTotalSize"] = "340";
      resizeElement(command, 140);
      delete container.dataset["testScrollHeight"];
      flushFrames();
      flushFrames();

      expect(container.scrollTop).toBe(240);
      controller.dispose();
    });
  });

  it("uses the pre-render bottom position when appending after an item resize", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 160 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first", "second"], [200, 200], "show-latest");
    expect(container.scrollTop).toBe(240);

    container.dataset["testTotalSize"] = "480";
    measureVirtualItem(controller, "second", 1, 280);

    renderVirtualItems(controller, container, ["first", "second", "third"], [200, 280, 120], "auto");

    expect(container.scrollTop).toBe(440);
    controller.dispose();
  });

  it("keeps the current reading position when an item below the viewport grows while unpinned", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first", "streaming"], [300, 100], "auto");
    container.scrollTop = 100;
    container.dispatchEvent(new Event("scroll"));

    container.dataset["testTotalSize"] = "550";
    measureVirtualItem(controller, "streaming", 1, 250);

    expect(container.scrollTop).toBe(100);
    controller.dispose();
  });

  it("preserves the visible anchor when older history is prepended", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first", "second", "third"], [240, 240, 240], "show-latest");
    userScrollTo(container, 260);
    const anchorKey = firstVisibleVirtualItemKey(controller, container, ["first", "second", "third"]);
    const anchorBefore = virtualItemTop(controller, container, anchorKey);

    renderVirtualItems(controller, container, ["older", "first", "second", "third"], [180, 240, 240, 240], "auto");

    expect(virtualItemTop(controller, container, anchorKey)).toBe(anchorBefore);
    controller.dispose();
  });

  it("preserves the visible anchor when older history is inserted after the history bar", () => {
    const container = messageContainer({ scrollTop: 80, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["history-bar", "current", "next"], [40, 300, 300], "auto");
    const anchorBefore = virtualItemTop(controller, container, "current");

    renderVirtualItems(controller, container, ["history-bar", "older", "current", "next"], [40, 180, 300, 300], "auto");

    expect(virtualItemTop(controller, container, "current")).toBe(anchorBefore);
    controller.dispose();
  });

  it("keeps the visible reading anchor when an earlier item resizes while unpinned", () => {
    withResizeObserverEntries((resizeElement, flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);
      const first = measuredElement("first", 0, 300);

      renderVirtualItems(controller, container, ["first", "second", "third"], [300, 300, 300], "auto");
      controller.measureElement(first);
      userScrollTo(container, 360);

      container.dataset["testTotalSize"] = "1100";
      resizeElement(first, 500);
      flushFrames();

      expect(container.scrollTop).toBe(560);
      controller.dispose();
    });
  });

  it("keeps the current reading offset when a visible item resizes while unpinned", () => {
    withResizeObserverEntries((resizeElement, flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);
      const second = measuredElement("second", 1, 300);

      renderVirtualItems(controller, container, ["first", "second", "third"], [300, 300, 300], "auto");
      controller.measureElement(second);
      userScrollTo(container, 360);

      container.dataset["testTotalSize"] = "1050";
      resizeElement(second, 450);
      flushFrames();

      expect(container.scrollTop).toBe(360);
      controller.dispose();
    });
  });

  it("keeps refreshing the reading anchor during continuous user scrolling", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first", "second", "third"], [300, 300, 300], "auto");
    container.dispatchEvent(new Event("wheel"));
    container.scrollTop = 320;
    container.dispatchEvent(new Event("scroll"));
    container.scrollTop = 380;
    container.dispatchEvent(new Event("scroll"));
    const anchorBefore = virtualItemTop(controller, container, "second");

    container.dataset["testTotalSize"] = "1000";
    measureVirtualItem(controller, "first", 0, 400);

    expect(virtualItemTop(controller, container, "second")).toBe(anchorBefore);
    controller.dispose();
  });

  it("does not leave blank space after visible content shrinks near the end", () => {
    withResizeObserverEntries((resizeElement, flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);
      const details = measuredElement("details", 1, 500);

      renderVirtualItems(controller, container, ["first", "details", "last"], [300, 500, 270], "show-latest");
      controller.measureElement(details);
      userScrollTo(container, 720);

      container.dataset["testTotalSize"] = "590";
      container.dataset["testScrollHeight"] = "1070";
      resizeElement(details, 20);
      flushFrames();

      expect(controller.getTotalSize()).toBe(590);
      expect(container.scrollTop).toBe(490);
      controller.dispose();
    });
  });

  it("keeps the reading position when the message viewport shrinks away from the end", () => {
    withResizeObserver((triggerResize) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 160 });
      const controller = createMessageStreamVirtualizerDriver(container);

      renderVirtualItems(controller, container, ["first", "second"], [240, 260], "show-latest");
      expect(container.scrollTop).toBe(340);

      userScrollTo(container, 120);
      setContainerClientHeight(container, 100);
      triggerResize();

      expect(container.scrollTop).toBe(120);
      controller.dispose();
    });
  });

  it("returns to the latest message when an active message viewport is restored from zero size", () => {
    withResizeObserver((triggerResize, flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);
      const first = renderedMeasuredElement("first", 0, 300);
      first.append(renderedMeasuredElement("stale-nested", 0, 900));
      appendRenderedVirtualizer(
        container,
        first,
        renderedMeasuredElement("second", 1, 100),
        renderedMeasuredElement("stale-sibling", 1, 900),
      );

      renderVirtualItems(controller, container, ["first", "second"], [300, 100], "show-latest");
      expect(container.scrollTop).toBe(300);

      userScrollTo(container, 120);
      setContainerClientSize(container, { width: 0, height: 0 });
      triggerResize();
      setContainerClientSize(container, { width: 240, height: 100 });
      triggerResize();
      flushFrames();

      expect(controller.getTotalSize()).toBe(400);
      expect(container.scrollTop).toBe(300);
      controller.dispose();
    });
  });

  it("shows the latest message when a hidden-at-start message viewport first renders at a usable size", () => {
    withResizeObserver((_triggerResize, flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 0 });
      const controller = createMessageStreamVirtualizerDriver(container);
      appendRenderedVirtualizer(container, renderedMeasuredElement("first", 0, 300), renderedMeasuredElement("second", 1, 100));
      setContainerClientSize(container, { width: 0, height: 0 });

      renderVirtualItems(controller, container, ["first", "second"], [300, 100], "auto");

      setContainerClientSize(container, { width: 240, height: 100 });
      controller.render(
        [
          { key: "first", node: null },
          { key: "second", node: null },
        ],
        "auto",
      );
      flushFrames();

      expect(controller.getTotalSize()).toBe(400);
      expect(container.scrollTop).toBe(300);
      controller.dispose();
    });
  });

  it("scrolls in both directions for composer text-line edge shortcuts", () => {
    const container = messageContainer({ scrollTop: 120, clientHeight: 100 });
    container.style.lineHeight = "18px";
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first", "second"], [240, 240], "auto");
    container.scrollTop = 120;
    container.dispatchEvent(new Event("scroll"));

    const initialScrollTop = container.scrollTop;
    controller.scrollByTextLines(-1);
    container.dispatchEvent(new Event("scroll"));
    const scrolledUpTop = container.scrollTop;
    expect(scrolledUpTop).toBeLessThan(initialScrollTop);
    expect(scrolledUpTop).toBeGreaterThan(0);
    expect(initialScrollTop - scrolledUpTop).toBeLessThanOrEqual(container.clientHeight / 2);

    controller.scrollByTextLines(1);
    container.dispatchEvent(new Event("scroll"));
    expect(container.scrollTop).toBeGreaterThan(scrolledUpTop);
    expect(container.scrollTop).toBeLessThanOrEqual(initialScrollTop);
    expect(container.scrollTop - scrolledUpTop).toBeLessThanOrEqual(container.clientHeight / 2);
    controller.dispose();
  });

  it("keeps bottom-following intent when composer edge scrolling is already at the bottom", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    container.style.lineHeight = "18px";
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first"], [300], "show-latest");
    expect(container.scrollTop).toBe(200);

    controller.scrollByTextLines(1);
    expect(container.scrollTop).toBe(200);

    renderVirtualItems(controller, container, ["first", "second"], [300, 140], "auto");
    expect(container.scrollTop).toBe(340);
    controller.dispose();
  });

  it("repins when composer edge scrolling reaches the bottom", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    container.style.lineHeight = "18px";
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first"], [300], "show-latest");
    userScrollTo(container, 180);

    controller.scrollByTextLines(1);
    expect(container.scrollTop).toBe(200);

    container.dataset["testTotalSize"] = "340";
    controller.repinToBottomIfPinned();
    flushVirtualizerEffects();
    expect(container.scrollTop).toBe(240);
    controller.dispose();
  });

  it("scrolls composer text-line shortcuts from the currently rendered bottom", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    container.style.lineHeight = "18px";
    const controller = createMessageStreamVirtualizerDriver(container);

    const keys = ["first", "second"];
    container.dataset["testTotalSize"] = "480";
    controller.render(
      keys.map((key) => ({ key, node: null })),
      "show-latest",
    );
    controller.getTotalSize();
    keys.forEach((key, index) => {
      measureVirtualItem(controller, key, index, 240);
    });
    controller.getTotalSize();
    const initialScrollTop = container.scrollTop;
    expectScrollAtEnd(container);

    controller.scrollByTextLines(-1);
    container.dispatchEvent(new Event("scroll"));

    expect(container.scrollTop).toBeLessThan(initialScrollTop);
    expect(initialScrollTop - container.scrollTop).toBeLessThanOrEqual(container.clientHeight / 2);
    controller.dispose();
  });

  it("keeps the same message visible when composer edge scrolling measures earlier items", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    container.style.lineHeight = "18px";
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first", "second", "third"], [240, 240, 240], "show-latest");
    expect(container.scrollTop).toBe(620);

    controller.scrollByTextLines(-1);
    container.dispatchEvent(new Event("scroll"));
    expect(container.scrollTop).toBe(584);
    const anchorBefore = virtualItemTop(controller, container, "third");

    container.dataset["testTotalSize"] = "980";
    measureVirtualItem(controller, "first", 0, 500);

    expect(virtualItemTop(controller, container, "third")).toBe(anchorBefore);
    controller.dispose();
  });

  it("treats body-targeted keyboard scrolling as message viewport user intent", () => {
    withAnimationFrame((flushFrames) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
      const controller = createMessageStreamVirtualizerDriver(container);

      renderVirtualItems(controller, container, ["first", "second"], [300, 200], "show-latest");
      expect(container.scrollTop).toBe(400);

      document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
      container.scrollTop = 360;
      container.dispatchEvent(new Event("scroll"));
      flushFrames();
      flushFrames();

      expect(container.scrollTop).toBe(360);
      controller.dispose();
    });
  });

  it("scrolls by a viewport step for composer PageUp and PageDown shortcuts", () => {
    const container = messageContainer({ scrollTop: 220, clientHeight: 200 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first", "second", "third"], [240, 240, 240], "auto");
    container.scrollTop = 220;
    container.dispatchEvent(new Event("scroll"));

    controller.scrollByPage(-1);
    container.dispatchEvent(new Event("scroll"));
    const pageUpTop = container.scrollTop;
    expect(pageUpTop).toBeLessThan(220);
    expect(pageUpTop).toBeGreaterThanOrEqual(0);
    expect(220 - pageUpTop).toBeLessThanOrEqual(container.clientHeight);

    controller.scrollByPage(1);
    container.dispatchEvent(new Event("scroll"));
    expect(container.scrollTop).toBeGreaterThan(pageUpTop);
    expect(container.scrollTop).toBeLessThanOrEqual(220);
    expect(container.scrollTop - pageUpTop).toBeLessThanOrEqual(container.clientHeight);

    container.scrollTop = 510;
    container.dispatchEvent(new Event("scroll"));
    controller.scrollByPage(1);
    container.dispatchEvent(new Event("scroll"));
    expectScrollAtEnd(container);
    controller.dispose();
  });

  it("keeps the same message visible when composer PageUp measurements shrink earlier items", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);
    const keys = numberedKeys("item", 50);
    container.dataset["testTotalSize"] = "4800";

    controller.render(
      keys.map((key) => ({ key, node: null })),
      "show-latest",
    );
    expect(container.scrollTop).toBe(4700);

    controller.scrollByPage(-1);
    expect(container.scrollTop).toBe(4620);
    const anchorKey = firstVisibleVirtualItemKey(controller, container, keys);
    const anchorBefore = virtualItemTop(controller, container, anchorKey);

    for (const item of controller.getVirtualItems()) {
      measureVirtualItem(controller, keys[item.index] ?? "", item.index, 20);
    }
    container.dataset["testTotalSize"] = String(controller.getTotalSize());
    clampScrollTop(container);
    container.dispatchEvent(new Event("scroll"));

    expect(virtualItemTop(controller, container, anchorKey)).toBe(anchorBefore);
    controller.dispose();
  });

  it("keeps repeated composer line scrolling relative to the same message when measurements shrink", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    container.style.lineHeight = "18px";
    const controller = createMessageStreamVirtualizerDriver(container);
    const keys = numberedKeys("item", 50);
    container.dataset["testTotalSize"] = "4800";

    controller.render(
      keys.map((key) => ({ key, node: null })),
      "show-latest",
    );
    userScrollTo(container, 4660);

    controller.scrollByTextLines(-1);
    expect(container.scrollTop).toBeLessThan(4660);
    expect(4660 - container.scrollTop).toBeLessThanOrEqual(container.clientHeight / 2);
    const anchorKey = firstVisibleVirtualItemKey(controller, container, keys);
    const anchorBefore = virtualItemTop(controller, container, anchorKey);

    for (const item of controller.getVirtualItems()) {
      measureVirtualItem(controller, keys[item.index] ?? "", item.index, 20);
    }
    container.dataset["testTotalSize"] = String(controller.getTotalSize());
    clampScrollTop(container);
    container.dispatchEvent(new Event("scroll"));

    expect(virtualItemTop(controller, container, anchorKey)).toBe(anchorBefore);
    controller.scrollByTextLines(-1);
    expect(virtualItemTop(controller, container, anchorKey)).toBeGreaterThan(anchorBefore);
    expect(virtualItemTop(controller, container, anchorKey) - anchorBefore).toBeLessThanOrEqual(container.clientHeight / 2);
    controller.dispose();
  });

  it("drops stale same-key measurements when show-latest replaces the message stream", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["same-key"], [360], "show-latest");
    expect(controller.getTotalSize()).toBe(360);
    expect(container.scrollTop).toBe(260);

    renderVirtualItems(controller, container, ["same-key"], [120], "show-latest");

    expect(controller.getTotalSize()).toBe(120);
    expect(container.scrollTop).toBe(20);
    controller.dispose();
  });

  it("keeps same-key measurements while preserving the current reading position", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["same-key"], [360], "show-latest");
    userScrollTo(container, 140);

    renderVirtualItems(controller, container, ["same-key"], [360], "auto");

    expect(controller.getTotalSize()).toBe(360);
    expect(container.scrollTop).toBe(140);
    controller.dispose();
  });

  it("keeps measured earlier blocks when following appended content", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(controller, container, ["first"], [240], "show-latest");

    renderVirtualItems(controller, container, ["first", "second"], [240, 160], "auto");

    expect(controller.getTotalSize()).toBe(400);
    expect(container.scrollTop).toBe(300);
    controller.dispose();
  });

  it("renders the new message stream from the end after show-latest replaces a long reading position", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = createMessageStreamVirtualizerDriver(container);

    renderVirtualItems(
      controller,
      container,
      numberedKeys("old", 80),
      Array.from({ length: 80 }, () => 40),
      "show-latest",
    );
    userScrollTo(container, 2400);

    controller.render(
      numberedKeys("new", 8).map((key) => ({ key, node: null })),
      "show-latest",
    );

    expect(controller.getVirtualItems().map((item) => item.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    controller.dispose();
  });
});

function renderVirtualItems(
  controller: MessageStreamVirtualizerDriver,
  container: HTMLElement,
  keys: string[],
  heights: number[],
  intent: TestMessageStreamScrollRequest,
): void {
  const blocks = keys.map((key) => ({ key, node: null }));
  container.dataset["testTotalSize"] = String(heights.reduce((total, height) => total + height, 0) + messageBlockPadding(container) * 2);
  controller.render(blocks, intent);
  controller.getTotalSize();
  keys.forEach((key, index) => {
    measureVirtualItem(controller, key, index, heights[index] ?? 0);
  });
  controller.getTotalSize();
  container.dispatchEvent(new Event("scroll"));
}

function firstVisibleVirtualItemKey(controller: MessageStreamVirtualizerDriver, container: HTMLElement, keys: string[]): string {
  const firstItem = controller.getVirtualItems().find((item) => item.end > container.scrollTop);
  if (!firstItem) throw new Error("Expected a rendered virtual item.");
  return keys[firstItem.index] ?? "";
}

function virtualItemTop(controller: MessageStreamVirtualizerDriver, container: HTMLElement, key: string): number {
  const item = controller.getVirtualItems().find((candidate) => candidate.key === key);
  if (!item) throw new Error(`Expected virtual item ${key}.`);
  return item.start - container.scrollTop;
}

function userScrollTo(container: HTMLElement, scrollTop: number): void {
  container.dispatchEvent(new Event("wheel"));
  container.scrollTop = scrollTop;
  container.dispatchEvent(new Event("scroll"));
}

function clampScrollTop(container: HTMLElement): void {
  const scrollTop = container.scrollTop;
  container.scrollTop = scrollTop;
}

function expectScrollAtEnd(container: HTMLElement): void {
  expect(container.scrollTop).toBe(Math.max(0, container.scrollHeight - container.clientHeight));
}

function measureVirtualItem(controller: MessageStreamVirtualizerDriver, key: string, index: number, height: number): void {
  controller.measureElement(measuredElement(key, index, height));
}

function measuredElement(key: string, index: number, height: number): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-codex-panel-block-key", key);
  element.setAttribute("data-index", String(index));
  Object.defineProperty(element, "offsetHeight", { value: height, configurable: true });
  Object.defineProperty(element, "isConnected", { value: true, configurable: true });
  return element;
}

function renderedMeasuredElement(key: string, index: number, height: number): HTMLElement {
  const element = measuredElement(key, index, height);
  element.classList.add("codex-panel__message-block");
  return element;
}

function appendRenderedVirtualizer(container: HTMLElement, ...blocks: HTMLElement[]): void {
  const virtualizer = document.createElement("div");
  virtualizer.classList.add("codex-panel__message-virtualizer");
  virtualizer.append(...blocks);
  container.append(virtualizer);
}

interface MessageStreamVirtualizerDriver {
  render(blocks: readonly MessageStreamBlock[], intent: TestMessageStreamScrollRequest): void;
  getTotalSize(): number;
  getVirtualItems(): ReturnType<MessageStreamVirtualizerView["getVirtualItems"]>;
  measureElement(element: HTMLElement | null): void;
  scrollByTextLines(direction: -1 | 1): void;
  scrollByPage(direction: -1 | 1): void;
  pinToBottom(): void;
  repinToBottomIfPinned(): void;
  dispose(): void;
}

function createMessageStreamVirtualizerDriver(container: HTMLElement): MessageStreamVirtualizerDriver {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let view: MessageStreamVirtualizerView | null = null;
  let mounted = false;
  const scrollController = createTestMessageStreamScrollController();
  return {
    render(blocks, intent) {
      const dispatchBeforeRender = mounted;
      if (dispatchBeforeRender) dispatchRenderIntent(scrollController, intent);
      const renderBlocks = [...blocks];
      void act(() => {
        renderUiRoot(
          host,
          h(VirtualizerHarness, {
            blocks: renderBlocks,
            container,
            scrollController,
            onView: (next) => (view = next),
          }),
        );
      });
      flushVirtualizerEffects();
      mounted = true;
      if (!dispatchBeforeRender) {
        void act(() => {
          if (intent === "show-latest") dispatchRenderIntent(scrollController, intent);
        });
        flushVirtualizerEffects();
      }
    },
    getTotalSize() {
      return view?.getTotalSize() ?? 0;
    },
    getVirtualItems() {
      return view?.getVirtualItems() ?? [];
    },
    measureElement(element) {
      void act(() => {
        view?.measureElement(element);
      });
      flushVirtualizerEffects();
    },
    scrollByTextLines(direction) {
      dispatchVirtualizerScrollCommand(scrollController, { kind: "scroll-by", amount: "text-lines", direction });
    },
    scrollByPage(direction) {
      dispatchVirtualizerScrollCommand(scrollController, { kind: "scroll-by", amount: "page", direction });
    },
    pinToBottom() {
      dispatchVirtualizerScrollCommand(scrollController, { kind: "show-latest" });
    },
    repinToBottomIfPinned() {
      dispatchVirtualizerScrollCommand(scrollController, { kind: "show-latest" });
    },
    dispose() {
      unmountUiRoot(host);
      host.remove();
    },
  };
}

function flushVirtualizerEffects(): void {
  void act(() => undefined);
}

function dispatchVirtualizerScrollCommand(scrollController: TestMessageStreamScrollController, command: MessageStreamScrollCommand): void {
  void act(() => {
    scrollController.dispatch(command);
  });
  flushVirtualizerEffects();
}

function dispatchRenderIntent(scrollController: TestMessageStreamScrollController, intent: TestMessageStreamScrollRequest): void {
  if (intent === "show-latest") scrollController.dispatch({ kind: "show-latest" });
}

interface TestMessageStreamScrollController extends MessageStreamScrollControllerBinding {
  dispatch(command: MessageStreamScrollCommand): void;
}

function createTestMessageStreamScrollController(): TestMessageStreamScrollController {
  let port: MessageStreamScrollPort | null = null;
  return {
    mountScrollPort(nextPort) {
      port = nextPort;
      return () => {
        if (port === nextPort) port = null;
      };
    },
    dispatch(command) {
      port?.dispatchScrollCommand(command);
    },
  };
}

function VirtualizerHarness({
  blocks,
  container,
  scrollController,
  onView,
}: {
  blocks: readonly MessageStreamBlock[];
  container: HTMLElement;
  scrollController: MessageStreamScrollControllerBinding;
  onView: (view: MessageStreamVirtualizerView) => void;
}) {
  const scrollElementRef = useRef<HTMLElement | null>(container);
  const view = useMessageStreamVirtualizer({
    blocks,
    scrollElementRef,
    scrollController,
  });
  useLayoutEffect(() => {
    onView(view);
  }, [onView, view]);
  return null;
}

function messageContainer(metrics: { scrollTop: number; clientHeight: number }): HTMLElement {
  const container = document.createElement("div");
  let scrollTop = metrics.scrollTop;
  let clientHeight = metrics.clientHeight;
  let clientWidth = 240;
  container.dataset["testClientHeight"] = String(metrics.clientHeight);
  container.dataset["testClientWidth"] = "240";
  Object.defineProperties(container, {
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        const scrollSize =
          container.dataset["testClampToScrollHeight"] === "true"
            ? container.scrollHeight
            : Math.max(container.scrollHeight, controllerTotalSize(container));
        scrollTop = Math.max(0, Math.min(value, Math.max(0, scrollSize - clientHeight)));
      },
      configurable: true,
    },
    scrollHeight: {
      get: () => {
        const scrollHeight = Number(container.dataset["testScrollHeight"]);
        return Number.isFinite(scrollHeight) && scrollHeight > 0 ? scrollHeight : controllerTotalSize(container);
      },
      configurable: true,
    },
    clientHeight: {
      get: () => {
        const nextClientHeight = Number(container.dataset["testClientHeight"]);
        clientHeight = Number.isFinite(nextClientHeight) && nextClientHeight >= 0 ? nextClientHeight : clientHeight;
        return clientHeight;
      },
      configurable: true,
    },
    offsetHeight: {
      get: () => container.clientHeight,
      configurable: true,
    },
    clientWidth: {
      get: () => {
        const nextClientWidth = Number(container.dataset["testClientWidth"]);
        clientWidth = Number.isFinite(nextClientWidth) && nextClientWidth >= 0 ? nextClientWidth : clientWidth;
        return clientWidth;
      },
      configurable: true,
    },
    offsetWidth: {
      get: () => container.clientWidth,
      configurable: true,
    },
  });
  document.body.appendChild(container);
  container.scrollTo = ((optionsOrX?: ScrollToOptions | number, y?: number) => {
    const top = typeof optionsOrX === "number" ? (y ?? container.scrollTop) : (optionsOrX?.top ?? container.scrollTop);
    container.scrollTop = top;
  }) as typeof container.scrollTo;
  return container;
}

function setContainerClientHeight(container: HTMLElement, clientHeight: number): void {
  container.dataset["testClientHeight"] = String(clientHeight);
}

function setContainerClientSize(container: HTMLElement, size: { width: number; height: number }): void {
  container.dataset["testClientWidth"] = String(size.width);
  container.dataset["testClientHeight"] = String(size.height);
}

function numberedKeys(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_value, index) => `${prefix}-${String(index)}`);
}

function controllerTotalSize(container: HTMLElement): number {
  const totalSize = Number(container.dataset["testTotalSize"]);
  return Number.isFinite(totalSize) && totalSize > 0 ? totalSize : 0;
}

function messageBlockPadding(container: HTMLElement): number {
  const value = Number.parseFloat(container.ownerDocument.defaultView?.getComputedStyle(container).paddingLeft ?? "");
  return Number.isFinite(value) ? value : 0;
}

function withResizeObserver(run: (triggerResize: () => void, flushFrames: () => void) => void): void {
  const previousResizeObserver = window.ResizeObserver;
  const previousRequestAnimationFrame = window.requestAnimationFrame;
  const previousCancelAnimationFrame = window.cancelAnimationFrame;
  const callbacks: ResizeObserverCallback[] = [];
  const frames: FrameRequestCallback[] = [];
  class TestResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }

    observe(): void {
      // Test callback triggering is explicit.
    }

    unobserve(): void {
      // Test callback triggering is explicit.
    }

    disconnect(): void {
      // Test callback triggering is explicit.
    }
  }
  window.ResizeObserver = TestResizeObserver;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
  try {
    const flushFrames = () => {
      void act(() => {
        for (const callback of callbacks) callback([], {} as ResizeObserver);
      });
      flushVirtualizerEffects();
      const pending = frames.splice(0);
      void act(() => {
        for (const frame of pending) frame(0);
      });
      flushVirtualizerEffects();
    };
    run(
      () => {
        frames.splice(0);
        flushFrames();
      },
      () => {
        const pending = frames.splice(0);
        void act(() => {
          for (const frame of pending) frame(0);
        });
        flushVirtualizerEffects();
      },
    );
  } finally {
    window.ResizeObserver = previousResizeObserver;
    window.requestAnimationFrame = previousRequestAnimationFrame;
    window.cancelAnimationFrame = previousCancelAnimationFrame;
  }
}

function withAnimationFrame(run: (flushFrames: () => void) => void): void {
  const previousRequestAnimationFrame = window.requestAnimationFrame;
  const previousCancelAnimationFrame = window.cancelAnimationFrame;
  const frames: { id: number; callback: FrameRequestCallback }[] = [];
  let nextFrameId = 1;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.push({ id, callback });
    return id;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    const index = frames.findIndex((frame) => frame.id === id);
    if (index >= 0) frames.splice(index, 1);
  }) as typeof window.cancelAnimationFrame;
  try {
    run(() => {
      const pending = frames.splice(0);
      void act(() => {
        for (const frame of pending) frame.callback(0);
      });
      flushVirtualizerEffects();
    });
  } finally {
    window.requestAnimationFrame = previousRequestAnimationFrame;
    window.cancelAnimationFrame = previousCancelAnimationFrame;
  }
}

function withResizeObserverEntries(
  run: (resizeElement: (element: HTMLElement, height: number) => void, flushFrames: () => void) => void,
): void {
  const previousResizeObserver = window.ResizeObserver;
  const previousRequestAnimationFrame = window.requestAnimationFrame;
  const previousCancelAnimationFrame = window.cancelAnimationFrame;
  const callbacks: ResizeObserverCallback[] = [];
  const frames: { id: number; callback: FrameRequestCallback }[] = [];
  let nextFrameId = 1;
  class TestResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }

    observe(): void {
      // Resize entries are triggered explicitly by the test.
    }

    unobserve(): void {
      // Resize entries are triggered explicitly by the test.
    }

    disconnect(): void {
      // Resize entries are triggered explicitly by the test.
    }
  }
  window.ResizeObserver = TestResizeObserver;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.push({ id, callback });
    return id;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    const index = frames.findIndex((frame) => frame.id === id);
    if (index >= 0) frames.splice(index, 1);
  }) as typeof window.cancelAnimationFrame;
  try {
    run(
      (element, height) => {
        Object.defineProperty(element, "offsetHeight", { value: height, configurable: true });
        const entry = {
          target: element,
          borderBoxSize: [{ blockSize: height }],
          contentBoxSize: [],
          contentRect: element.getBoundingClientRect(),
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry;
        void act(() => {
          for (const callback of callbacks) callback([entry], {} as ResizeObserver);
        });
        flushVirtualizerEffects();
      },
      () => {
        const pending = frames.splice(0);
        void act(() => {
          for (const frame of pending) frame.callback(0);
        });
        flushVirtualizerEffects();
      },
    );
  } finally {
    window.ResizeObserver = previousResizeObserver;
    window.requestAnimationFrame = previousRequestAnimationFrame;
    window.cancelAnimationFrame = previousCancelAnimationFrame;
  }
}
