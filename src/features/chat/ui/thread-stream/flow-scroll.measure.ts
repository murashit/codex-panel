import { Component, h, type ComponentChild as UiNode } from "preact";

import { disposeDomListeners, listenDomEvent } from "../../../../shared/dom/events.dom";
import { THREAD_STREAM_CONTENT_RENDERED_EVENT } from "./content-rendered-event.dom";

type ThreadStreamScrollDirection = -1 | 1;

const THREAD_STREAM_FLOW_TEXT_LINE_SCROLL_LINES = 4;
const THREAD_STREAM_FLOW_REPEATED_TEXT_LINE_SCROLL_LINES = 4;

export type ThreadStreamScrollCommand =
  | { kind: "show-latest" }
  | { kind: "scroll-to"; edge: "start" | "end" }
  | { kind: "scroll-by"; amount: "text-lines" | "page"; direction: ThreadStreamScrollDirection; repeated?: boolean };

export interface ThreadStreamScrollPort {
  dispatchScrollCommand(command: ThreadStreamScrollCommand): void;
}

export interface ThreadStreamScrollPortBinding {
  mountScrollPort(port: ThreadStreamScrollPort): () => void;
}

export interface ThreadStreamFlowBlockIdentity {
  key: string;
}

export interface ThreadStreamFlowFrameProps<Block extends ThreadStreamFlowBlockIdentity> {
  blocks: readonly Block[];
  rootAttributes?: Partial<Record<`data-${string}`, string>>;
  scrollPortBinding: ThreadStreamScrollPortBinding;
  renderBlockContent: (block: Block) => UiNode;
}

interface ThreadStreamFlowReadingAnchor {
  key: string;
  top: number;
}

type ThreadStreamFlowSnapshot = ThreadStreamFlowReadingAnchor | null;

interface ThreadStreamFlowRuntime {
  container: HTMLElement | null;
  followingEnd: boolean;
  restoreFrame: number | null;
  resizeObserver: ResizeObserver | null;
}

export class ThreadStreamFlowFrame<Block extends ThreadStreamFlowBlockIdentity> extends Component<ThreadStreamFlowFrameProps<Block>> {
  private readonly runtime = createThreadStreamFlowRuntime();
  private readonly scrollPort: ThreadStreamScrollPort = {
    dispatchScrollCommand: (command) => {
      applyThreadStreamFlowScrollCommand(this.runtime, command);
    },
  };
  private scrollElement: HTMLElement | null = null;
  private unmountScrollPort: (() => void) | null = null;

  override componentDidMount(): void {
    this.mountScrollPort();
    attachThreadStreamFlowContainer(this.runtime, this.scrollElement);
    completeThreadStreamFlowRender(this.runtime, null);
  }

  override getSnapshotBeforeUpdate(previousProps: Readonly<ThreadStreamFlowFrameProps<Block>>): ThreadStreamFlowSnapshot | null {
    return captureThreadStreamFlowSnapshot(this.runtime, this.scrollElement, previousProps.blocks, this.props.blocks);
  }

  override componentDidUpdate(
    previousProps: Readonly<ThreadStreamFlowFrameProps<Block>>,
    _previousState: Readonly<Record<string, never>>,
    snapshot: ThreadStreamFlowSnapshot | null,
  ): void {
    if (previousProps.scrollPortBinding !== this.props.scrollPortBinding) this.mountScrollPort();
    if (this.runtime.container !== this.scrollElement) attachThreadStreamFlowContainer(this.runtime, this.scrollElement);
    completeThreadStreamFlowRender(this.runtime, snapshot);
  }

  override componentWillUnmount(): void {
    this.unmountScrollPort?.();
    this.unmountScrollPort = null;
    disposeThreadStreamFlowRuntime(this.runtime);
  }

  override render({ blocks, renderBlockContent, rootAttributes }: ThreadStreamFlowFrameProps<Block>): UiNode {
    return h(
      "div",
      {
        ...rootAttributes,
        ref: this.setScrollElement,
        className: "codex-panel__region codex-panel__region--thread-stream codex-panel__thread-stream",
      },
      h(
        "div",
        { className: "codex-panel__thread-stream-flow" },
        blocks.map((block) =>
          h(
            "div",
            {
              ref: this.notifyBlockLayout,
              key: block.key,
              className: "codex-panel__thread-stream-block",
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
    handleThreadStreamFlowBlockLayout(this.runtime, element);
  };

  private mountScrollPort(): void {
    this.unmountScrollPort?.();
    this.unmountScrollPort = this.props.scrollPortBinding.mountScrollPort(this.scrollPort);
  }
}

function createThreadStreamFlowRuntime(): ThreadStreamFlowRuntime {
  return {
    container: null,
    followingEnd: false,
    restoreFrame: null,
    resizeObserver: null,
  };
}

function captureThreadStreamFlowSnapshot(
  runtime: ThreadStreamFlowRuntime,
  container: HTMLElement | null,
  previousBlocks: readonly ThreadStreamFlowBlockIdentity[],
  nextBlocks: readonly ThreadStreamFlowBlockIdentity[],
): ThreadStreamFlowSnapshot | null {
  if (!container || runtime.followingEnd || !threadStreamFlowBlocksShifted(previousBlocks, nextBlocks)) return null;
  return captureThreadStreamFlowReadingAnchor(container);
}

function completeThreadStreamFlowRender(runtime: ThreadStreamFlowRuntime, snapshot: ThreadStreamFlowSnapshot | null): void {
  const container = runtime.container;
  if (!container) return;

  if (runtime.followingEnd) {
    scrollThreadStreamFlowToEnd(runtime);
    return;
  }

  if (snapshot) restoreThreadStreamFlowReadingAnchor(container, snapshot);
}

function attachThreadStreamFlowContainer(runtime: ThreadStreamFlowRuntime, container: HTMLElement | null): void {
  if (runtime.container === container) return;
  detachThreadStreamFlowContainer(runtime);
  runtime.container = container;
  runtime.followingEnd = container ? isThreadStreamFlowAtEnd(container) || isThreadStreamFlowViewportHidden(container) : false;
  if (!container) return;

  const handleScroll = () => {
    runtime.followingEnd = isThreadStreamFlowAtEnd(container);
  };
  const handleContentChange = () => {
    if (!runtime.followingEnd) return;
    scrollThreadStreamFlowToEnd(runtime);
    scheduleThreadStreamFlowEndRestore(runtime);
  };
  const win = container.ownerDocument.defaultView;
  if (win?.ResizeObserver) {
    runtime.resizeObserver = new win.ResizeObserver(() => {
      if (runtime.followingEnd) scheduleThreadStreamFlowEndRestore(runtime);
    });
    runtime.resizeObserver.observe(container);
  }

  runtime.restoreFrame = null;
  cleanupThreadStreamFlowContainer.set(
    runtime,
    disposeDomListeners(
      listenDomEvent(container, "scroll", handleScroll, { passive: true }),
      listenDomEvent(container, THREAD_STREAM_CONTENT_RENDERED_EVENT, handleContentChange, true),
      listenDomEvent(container, "toggle", handleContentChange, true),
      () => {
        runtime.resizeObserver?.disconnect();
        runtime.resizeObserver = null;
      },
    ),
  );
}

const cleanupThreadStreamFlowContainer = new WeakMap<ThreadStreamFlowRuntime, () => void>();

function detachThreadStreamFlowContainer(runtime: ThreadStreamFlowRuntime): void {
  cancelThreadStreamFlowEndRestore(runtime);
  cleanupThreadStreamFlowContainer.get(runtime)?.();
  cleanupThreadStreamFlowContainer.delete(runtime);
  runtime.container = null;
}

function disposeThreadStreamFlowRuntime(runtime: ThreadStreamFlowRuntime): void {
  detachThreadStreamFlowContainer(runtime);
  runtime.followingEnd = false;
}

function applyThreadStreamFlowScrollCommand(runtime: ThreadStreamFlowRuntime, command: ThreadStreamScrollCommand): void {
  switch (command.kind) {
    case "show-latest":
      runtime.followingEnd = true;
      scrollThreadStreamFlowToEnd(runtime);
      scheduleThreadStreamFlowEndRestore(runtime);
      break;
    case "scroll-to":
      if (command.edge === "start") {
        scrollThreadStreamFlowToStart(runtime, threadStreamFlowManualScrollBehavior(runtime, false));
      } else {
        runtime.followingEnd = true;
        scrollThreadStreamFlowToEnd(runtime, threadStreamFlowManualScrollBehavior(runtime, false));
      }
      break;
    case "scroll-by":
      scrollThreadStreamFlowBy(
        runtime,
        threadStreamFlowScrollDelta(runtime, command.amount, command.direction, command.repeated === true),
        threadStreamFlowManualScrollBehavior(runtime, command.repeated === true),
      );
      break;
  }
}

function handleThreadStreamFlowBlockLayout(runtime: ThreadStreamFlowRuntime, element: HTMLElement | null): void {
  if (!element || !runtime.followingEnd) return;
  scrollThreadStreamFlowToEnd(runtime);
  scheduleThreadStreamFlowEndRestore(runtime);
}

function scrollThreadStreamFlowBy(runtime: ThreadStreamFlowRuntime, delta: number, behavior: ScrollBehavior = "auto"): void {
  const container = runtime.container;
  if (!container) return;
  const targetTop = clampThreadStreamFlowScrollTop(container, container.scrollTop + delta);
  scrollThreadStreamFlowToTop(container, targetTop, behavior);
  runtime.followingEnd = isThreadStreamFlowTopAtEnd(container, targetTop);
}

function scrollThreadStreamFlowToStart(runtime: ThreadStreamFlowRuntime, behavior: ScrollBehavior = "auto"): void {
  const container = runtime.container;
  if (!container) return;
  scrollThreadStreamFlowToTop(container, 0, behavior);
  runtime.followingEnd = false;
}

function threadStreamFlowScrollDelta(
  runtime: ThreadStreamFlowRuntime,
  amount: "text-lines" | "page",
  direction: ThreadStreamScrollDirection,
  repeated: boolean,
): number {
  const container = runtime.container;
  if (!container) return 0;
  if (amount === "page") return Math.max(1, Math.floor(container.clientHeight * 0.8)) * direction;
  const lines = repeated ? THREAD_STREAM_FLOW_REPEATED_TEXT_LINE_SCROLL_LINES : THREAD_STREAM_FLOW_TEXT_LINE_SCROLL_LINES;
  return Math.max(1, Math.round(textLineHeight(container) * lines)) * direction;
}

function scrollThreadStreamFlowToEnd(runtime: ThreadStreamFlowRuntime, behavior: ScrollBehavior = "auto"): void {
  const container = runtime.container;
  if (!container) return;
  scrollThreadStreamFlowToTop(container, threadStreamFlowEndScrollTop(container), behavior);
  runtime.followingEnd = true;
}

function scrollThreadStreamFlowToTop(container: HTMLElement, top: number, behavior: ScrollBehavior): void {
  if (behavior === "smooth") {
    container.scrollTo({ top, behavior });
    return;
  }

  container.scrollTop = top;
}

function threadStreamFlowManualScrollBehavior(runtime: ThreadStreamFlowRuntime, repeated: boolean): ScrollBehavior {
  if (repeated) return "auto";
  const win = runtime.container?.win;
  return win?.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function threadStreamFlowEndScrollTop(container: HTMLElement): number {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

function clampThreadStreamFlowScrollTop(container: HTMLElement, top: number): number {
  return Math.max(0, Math.min(top, threadStreamFlowEndScrollTop(container)));
}

function scheduleThreadStreamFlowEndRestore(runtime: ThreadStreamFlowRuntime): void {
  const container = runtime.container;
  if (!container || runtime.restoreFrame !== null) return;
  runtime.restoreFrame = container.win.requestAnimationFrame(() => {
    runtime.restoreFrame = null;
    if (runtime.container === container && runtime.followingEnd) scrollThreadStreamFlowToEnd(runtime);
  });
}

function cancelThreadStreamFlowEndRestore(runtime: ThreadStreamFlowRuntime): void {
  const container = runtime.container;
  const frame = runtime.restoreFrame;
  if (container && frame !== null) container.win.cancelAnimationFrame(frame);
  runtime.restoreFrame = null;
}

function threadStreamFlowBlocksShifted(
  previous: readonly ThreadStreamFlowBlockIdentity[],
  next: readonly ThreadStreamFlowBlockIdentity[],
): boolean {
  if (previous.length === 0 || next.length === 0) return false;
  if (previous.length !== next.length) return true;
  return previous.some((block, index) => block.key !== next[index]?.key);
}

function captureThreadStreamFlowReadingAnchor(container: HTMLElement): ThreadStreamFlowReadingAnchor | null {
  const viewportTop = container.getBoundingClientRect().top;
  for (const element of threadStreamFlowBlockElements(container)) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom >= viewportTop) {
      const key = element.dataset["codexPanelBlockKey"];
      return key ? { key, top: rect.top - viewportTop } : null;
    }
  }
  return null;
}

function restoreThreadStreamFlowReadingAnchor(container: HTMLElement, anchor: ThreadStreamFlowReadingAnchor): void {
  const element = threadStreamFlowBlockElements(container).find((candidate) => candidate.dataset["codexPanelBlockKey"] === anchor.key);
  if (!element) return;
  const viewportTop = container.getBoundingClientRect().top;
  const currentTop = element.getBoundingClientRect().top - viewportTop;
  container.scrollTop += currentTop - anchor.top;
}

function threadStreamFlowBlockElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".codex-panel__thread-stream-block"));
}

function isThreadStreamFlowAtEnd(container: HTMLElement): boolean {
  return isThreadStreamFlowTopAtEnd(container, container.scrollTop);
}

function isThreadStreamFlowTopAtEnd(container: HTMLElement, top: number): boolean {
  return threadStreamFlowEndScrollTop(container) - top <= 4;
}

function isThreadStreamFlowViewportHidden(container: HTMLElement): boolean {
  return container.clientWidth <= 0 || container.clientHeight <= 0;
}

function textLineHeight(element: HTMLElement): number {
  const style = element.win.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.5 : 20;
}
