import { Component, h, type ComponentChild as UiNode } from "preact";

import { MESSAGE_CONTENT_RENDERED_EVENT } from "./content-events";

type MessageScrollDirection = -1 | 1;

export type MessageStreamScrollCommand =
  | { kind: "show-latest" }
  | { kind: "scroll-to"; edge: "start" | "end" }
  | { kind: "scroll-by"; amount: "text-lines" | "page"; direction: MessageScrollDirection };

export interface MessageStreamScrollPort {
  dispatchScrollCommand(command: MessageStreamScrollCommand): void;
}

export interface MessageStreamScrollControllerBinding {
  mountScrollPort(port: MessageStreamScrollPort): () => void;
}

export interface MessageStreamFlowBlockIdentity {
  key: string;
}

export interface MessageStreamFlowFrameProps<Block extends MessageStreamFlowBlockIdentity> {
  blocks: readonly Block[];
  rootAttributes?: Partial<Record<`data-${string}`, string>>;
  scrollController: MessageStreamScrollControllerBinding;
  renderBlockContent: (block: Block) => UiNode;
}

interface MessageFlowReadingAnchor {
  key: string;
  top: number;
}

type MessageFlowSnapshot = MessageFlowReadingAnchor | null;

interface MessageFlowRuntime {
  container: HTMLElement | null;
  followingEnd: boolean;
  restoreFrame: number | null;
  resizeObserver: ResizeObserver | null;
}

export class MessageStreamFlowFrame<Block extends MessageStreamFlowBlockIdentity> extends Component<MessageStreamFlowFrameProps<Block>> {
  private readonly runtime = createMessageFlowRuntime();
  private readonly scrollPort: MessageStreamScrollPort = {
    dispatchScrollCommand: (command) => {
      applyMessageFlowScrollCommand(this.runtime, command);
    },
  };
  private scrollElement: HTMLElement | null = null;
  private unmountScrollPort: (() => void) | null = null;

  override componentDidMount(): void {
    this.mountScrollPort();
    attachMessageFlowContainer(this.runtime, this.scrollElement);
    completeMessageFlowRender(this.runtime, null);
  }

  override getSnapshotBeforeUpdate(previousProps: Readonly<MessageStreamFlowFrameProps<Block>>): MessageFlowSnapshot | null {
    return captureMessageFlowSnapshot(this.runtime, this.scrollElement, previousProps.blocks, this.props.blocks);
  }

  override componentDidUpdate(
    previousProps: Readonly<MessageStreamFlowFrameProps<Block>>,
    _previousState: Readonly<Record<string, never>>,
    snapshot: MessageFlowSnapshot | null,
  ): void {
    if (previousProps.scrollController !== this.props.scrollController) this.mountScrollPort();
    if (this.runtime.container !== this.scrollElement) attachMessageFlowContainer(this.runtime, this.scrollElement);
    completeMessageFlowRender(this.runtime, snapshot);
  }

  override componentWillUnmount(): void {
    this.unmountScrollPort?.();
    this.unmountScrollPort = null;
    disposeMessageFlowRuntime(this.runtime);
  }

  override render({ blocks, renderBlockContent, rootAttributes }: MessageStreamFlowFrameProps<Block>): UiNode {
    return h(
      "div",
      {
        ...rootAttributes,
        ref: this.setScrollElement,
        className: "codex-panel__region codex-panel__region--message-stream codex-panel__messages",
      },
      h(
        "div",
        { className: "codex-panel__message-flow" },
        blocks.map((block) =>
          h(
            "div",
            {
              ref: this.notifyBlockLayout,
              key: block.key,
              className: "codex-panel__message-block",
              "data-codex-panel-block-key": block.key,
            },
            renderBlockContent(block),
          ),
        ),
      ),
    );
  }

  private readonly setScrollElement = (element: HTMLElement | null): void => {
    this.scrollElement = element;
  };

  private readonly notifyBlockLayout = (element: HTMLElement | null): void => {
    handleMessageFlowBlockLayout(this.runtime, element);
  };

  private mountScrollPort(): void {
    this.unmountScrollPort?.();
    this.unmountScrollPort = this.props.scrollController.mountScrollPort(this.scrollPort);
  }
}

function createMessageFlowRuntime(): MessageFlowRuntime {
  return {
    container: null,
    followingEnd: false,
    restoreFrame: null,
    resizeObserver: null,
  };
}

function captureMessageFlowSnapshot(
  runtime: MessageFlowRuntime,
  container: HTMLElement | null,
  previousBlocks: readonly MessageStreamFlowBlockIdentity[],
  nextBlocks: readonly MessageStreamFlowBlockIdentity[],
): MessageFlowSnapshot | null {
  if (!container || runtime.followingEnd || !messageFlowBlocksShifted(previousBlocks, nextBlocks)) return null;
  return captureMessageFlowReadingAnchor(container);
}

function completeMessageFlowRender(runtime: MessageFlowRuntime, snapshot: MessageFlowSnapshot | null): void {
  const container = runtime.container;
  if (!container) return;

  if (runtime.followingEnd) {
    scrollMessageFlowToEnd(runtime);
    return;
  }

  if (snapshot) restoreMessageFlowReadingAnchor(container, snapshot);
}

function attachMessageFlowContainer(runtime: MessageFlowRuntime, container: HTMLElement | null): void {
  if (runtime.container === container) return;
  detachMessageFlowContainer(runtime);
  runtime.container = container;
  runtime.followingEnd = container ? isMessageFlowAtEnd(container) || isMessageFlowViewportHidden(container) : false;
  if (!container) return;

  const handleScroll = () => {
    runtime.followingEnd = isMessageFlowAtEnd(container);
  };
  const handleContentChange = () => {
    if (!runtime.followingEnd) return;
    scrollMessageFlowToEnd(runtime);
    scheduleMessageFlowEndRestore(runtime);
  };
  container.addEventListener("scroll", handleScroll, { passive: true });
  container.addEventListener(MESSAGE_CONTENT_RENDERED_EVENT, handleContentChange, true);
  container.addEventListener("toggle", handleContentChange, true);

  const win = container.ownerDocument.defaultView;
  if (win?.ResizeObserver) {
    runtime.resizeObserver = new win.ResizeObserver(() => {
      if (runtime.followingEnd) scheduleMessageFlowEndRestore(runtime);
    });
    runtime.resizeObserver.observe(container);
  }

  runtime.restoreFrame = null;
  cleanupMessageFlowContainer.set(runtime, () => {
    container.removeEventListener("scroll", handleScroll);
    container.removeEventListener(MESSAGE_CONTENT_RENDERED_EVENT, handleContentChange, true);
    container.removeEventListener("toggle", handleContentChange, true);
    runtime.resizeObserver?.disconnect();
    runtime.resizeObserver = null;
  });
}

const cleanupMessageFlowContainer = new WeakMap<MessageFlowRuntime, () => void>();

function detachMessageFlowContainer(runtime: MessageFlowRuntime): void {
  cancelMessageFlowEndRestore(runtime);
  cleanupMessageFlowContainer.get(runtime)?.();
  cleanupMessageFlowContainer.delete(runtime);
  runtime.container = null;
}

function disposeMessageFlowRuntime(runtime: MessageFlowRuntime): void {
  detachMessageFlowContainer(runtime);
  runtime.followingEnd = false;
}

function applyMessageFlowScrollCommand(runtime: MessageFlowRuntime, command: MessageStreamScrollCommand): void {
  switch (command.kind) {
    case "show-latest":
      runtime.followingEnd = true;
      scrollMessageFlowToEnd(runtime);
      scheduleMessageFlowEndRestore(runtime);
      break;
    case "scroll-to":
      if (command.edge === "start") {
        scrollMessageFlowToStart(runtime);
      } else {
        runtime.followingEnd = true;
        scrollMessageFlowToEnd(runtime);
        scheduleMessageFlowEndRestore(runtime);
      }
      break;
    case "scroll-by":
      scrollMessageFlowBy(runtime, messageFlowScrollDelta(runtime, command.amount, command.direction));
      break;
  }
}

function handleMessageFlowBlockLayout(runtime: MessageFlowRuntime, element: HTMLElement | null): void {
  if (!element || !runtime.followingEnd) return;
  scrollMessageFlowToEnd(runtime);
  scheduleMessageFlowEndRestore(runtime);
}

function scrollMessageFlowBy(runtime: MessageFlowRuntime, delta: number): void {
  const container = runtime.container;
  if (!container) return;
  container.scrollTop += delta;
  runtime.followingEnd = isMessageFlowAtEnd(container);
}

function scrollMessageFlowToStart(runtime: MessageFlowRuntime): void {
  const container = runtime.container;
  if (!container) return;
  container.scrollTop = 0;
  runtime.followingEnd = false;
}

function messageFlowScrollDelta(runtime: MessageFlowRuntime, amount: "text-lines" | "page", direction: MessageScrollDirection): number {
  const container = runtime.container;
  if (!container) return 0;
  if (amount === "page") return Math.max(1, Math.floor(container.clientHeight * 0.8)) * direction;
  return Math.max(1, Math.round(textLineHeight(container) * 2)) * direction;
}

function scrollMessageFlowToEnd(runtime: MessageFlowRuntime): void {
  const container = runtime.container;
  if (!container) return;
  container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  runtime.followingEnd = true;
}

function scheduleMessageFlowEndRestore(runtime: MessageFlowRuntime): void {
  const container = runtime.container;
  if (!container || runtime.restoreFrame !== null) return;
  runtime.restoreFrame = container.win.requestAnimationFrame(() => {
    runtime.restoreFrame = null;
    if (runtime.container === container && runtime.followingEnd) scrollMessageFlowToEnd(runtime);
  });
}

function cancelMessageFlowEndRestore(runtime: MessageFlowRuntime): void {
  const container = runtime.container;
  const frame = runtime.restoreFrame;
  if (container && frame !== null) container.win.cancelAnimationFrame(frame);
  runtime.restoreFrame = null;
}

function messageFlowBlocksShifted(
  previous: readonly MessageStreamFlowBlockIdentity[],
  next: readonly MessageStreamFlowBlockIdentity[],
): boolean {
  if (previous.length === 0 || next.length === 0) return false;
  if (previous.length !== next.length) return true;
  return previous.some((block, index) => block.key !== next[index]?.key);
}

function captureMessageFlowReadingAnchor(container: HTMLElement): MessageFlowReadingAnchor | null {
  const viewportTop = container.getBoundingClientRect().top;
  for (const element of messageFlowBlockElements(container)) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom >= viewportTop) {
      const key = element.dataset["codexPanelBlockKey"];
      return key ? { key, top: rect.top - viewportTop } : null;
    }
  }
  return null;
}

function restoreMessageFlowReadingAnchor(container: HTMLElement, anchor: MessageFlowReadingAnchor): void {
  const element = messageFlowBlockElements(container).find((candidate) => candidate.dataset["codexPanelBlockKey"] === anchor.key);
  if (!element) return;
  const viewportTop = container.getBoundingClientRect().top;
  const currentTop = element.getBoundingClientRect().top - viewportTop;
  container.scrollTop += currentTop - anchor.top;
}

function messageFlowBlockElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".codex-panel__message-block"));
}

function isMessageFlowAtEnd(container: HTMLElement): boolean {
  return container.scrollHeight - container.clientHeight - container.scrollTop <= 4;
}

function isMessageFlowViewportHidden(container: HTMLElement): boolean {
  return container.clientWidth <= 0 || container.clientHeight <= 0;
}

function textLineHeight(element: HTMLElement): number {
  const style = element.win.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.5 : 20;
}
