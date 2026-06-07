import { type ComponentChild as UiNode, type Ref } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { executionState } from "../../display/state";
import type { DisplayItem } from "../../display/types";
import { MESSAGE_CONTENT_RENDERED_EVENT } from "../message-content-events";
import type { MessageContentContext, MessageItemContext, RenderableTextItem } from "./context";
import { MessageRole } from "./message-actions";
import { AutoReviewSummaries, EditedFiles, MentionedFiles, MessageDetails, ReferencedThread, SystemDetails } from "./message-metadata";

const USER_MESSAGE_COLLAPSE_HEIGHT_PX = 360;

export function messageItemNode(item: RenderableTextItem, context: MessageItemContext): UiNode {
  return <MessageItem item={item} context={context} />;
}

function MessageItem({ item, context }: { item: RenderableTextItem; context: MessageItemContext }): UiNode {
  const collapsible = isCollapsibleUserMessage(item);
  const details = "details" in item ? item.details : undefined;
  return (
    <div className={`${messageClass(item)}${executionClassName(executionState(item))}`}>
      <MessageRole item={item} context={context} />
      {collapsible ? (
        <CollapsibleMessageContent item={item} context={context} />
      ) : (
        <TextContent key={messageContentKey(item)} item={item} context={context} />
      )}
      {item.kind === "message" && item.editedFiles && item.editedFiles.length > 0 ? <EditedFiles item={item} context={context} /> : null}
      {item.kind === "message" && item.referencedThread ? <ReferencedThread item={item} /> : null}
      {item.kind === "message" && item.mentionedFiles && item.mentionedFiles.length > 0 ? (
        <MentionedFiles item={item} context={context} />
      ) : null}
      {item.kind === "message" && item.autoReviewSummaries && item.autoReviewSummaries.length > 0 ? (
        <AutoReviewSummaries summaries={item.autoReviewSummaries} />
      ) : null}
      {item.kind === "system" && item.details && item.details.length > 0 ? (
        <SystemDetails details={item.details} />
      ) : details && details.length > 0 ? (
        <MessageDetails itemId={item.id} details={details} context={context} />
      ) : null}
    </div>
  );
}

function CollapsibleMessageContent({ item, context }: { item: RenderableTextItem; context: MessageContentContext }): UiNode {
  const key = `message:${item.id}:expanded`;
  const renderModeKey = contentRenderMode(item);
  const collapseRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(context.openDetails.has(key));

  useLayoutEffect(() => {
    setExpanded(context.openDetails.has(key));
  }, [context.openDetails, key]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const update = () => {
      setOverflows(content.scrollHeight > userMessageCollapseHeight(content) + 1);
    };
    content.addEventListener(MESSAGE_CONTENT_RENDERED_EVENT, update);
    update();
    content.win.requestAnimationFrame(update);
    return () => {
      content.removeEventListener(MESSAGE_CONTENT_RENDERED_EVENT, update);
    };
  }, [item.id, item.text, renderModeKey]);

  useEffect(() => {
    if (!overflows || !expanded) return;
    const doc = collapseRef.current?.ownerDocument;
    if (!doc) return;
    const collapseOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && collapseRef.current?.contains(event.target)) return;
      setExpanded(false);
      context.onDetailsToggle?.(key, false);
    };
    doc.addEventListener("pointerdown", collapseOnOutsidePointer, true);
    return () => {
      doc.removeEventListener("pointerdown", collapseOnOutsidePointer, true);
    };
  }, [context, expanded, key, overflows]);

  return (
    <div
      ref={collapseRef}
      className={[
        "codex-panel__message-collapse",
        overflows ? "codex-panel__message-collapse--overflow" : "",
        overflows && expanded ? "codex-panel__message-collapse--expanded" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <TextContent key={messageContentKey(item)} item={item} context={context} contentRef={contentRef} collapsed={overflows && !expanded} />
      <details
        className="codex-panel__message-collapse-details"
        hidden={!overflows || expanded}
        onToggle={(event) => {
          if (!event.currentTarget.open) return;
          event.currentTarget.open = false;
          setExpanded(true);
          context.onDetailsToggle?.(key, true);
        }}
      >
        <summary tabIndex={-1}>Show more</summary>
      </details>
    </div>
  );
}

interface TextContentProps {
  item: RenderableTextItem;
  context: MessageContentContext;
  contentRef?: Ref<HTMLDivElement>;
  collapsed?: boolean;
}

function TextContent({ item, context, contentRef, collapsed = false }: TextContentProps): UiNode {
  const renderModeKey = contentRenderMode(item);
  const rendersMarkdown = renderModeKey === "markdown";
  const text = item.text;
  const localRef = useRef<HTMLDivElement | null>(null);
  const contextRef = useRef(context);
  useLayoutEffect(() => {
    contextRef.current = context;
  });
  useLayoutEffect(() => {
    const content = localRef.current;
    if (!content) return;
    const currentContext = contextRef.current;
    content.replaceChildren();
    if (rendersMarkdown) {
      currentContext.renderMarkdown(content, text);
    } else {
      content.textContent = text;
    }
  }, [renderModeKey, rendersMarkdown, text]);
  return (
    <div
      ref={(element) => {
        localRef.current = element;
        if (typeof contentRef === "function") {
          contentRef(element);
        } else if (contentRef) {
          contentRef.current = element;
        }
      }}
      className={[
        "codex-panel__message-content",
        rendersMarkdown ? "markdown-rendered" : "",
        collapsed ? "codex-panel__message-content--collapsed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

function messageContentKey(item: RenderableTextItem): string {
  return `${item.id}\u001f${contentRenderMode(item)}\u001f${item.text}`;
}

function contentRenderMode(item: RenderableTextItem): "markdown" | "text" {
  if (item.kind !== "message") return "text";
  return item.messageKind === "proposedPlan" && item.messageState === "streaming" ? "text" : "markdown";
}

function executionClassName(state: ReturnType<typeof executionState>): string {
  return state ? ` codex-panel__execution codex-panel__execution--${state}` : "";
}

function isCollapsibleUserMessage(item: DisplayItem): boolean {
  return item.kind === "message" && item.role === "user";
}

function userMessageCollapseHeight(element: HTMLElement): number {
  const viewportHeight = element.win.innerHeight;
  if (viewportHeight <= 0) return USER_MESSAGE_COLLAPSE_HEIGHT_PX;
  return Math.min(USER_MESSAGE_COLLAPSE_HEIGHT_PX, viewportHeight * 0.45);
}

function messageClass(item: DisplayItem): string {
  const classes = ["codex-panel__message", `codex-panel__message--${item.role}`];
  if (item.kind === "approvalResult") classes.push("codex-panel__message--approval-result");
  if (item.kind === "userInputResult") classes.push("codex-panel__message--user-input-result");
  if (item.kind === "reviewResult") classes.push("codex-panel__message--review-result");
  return classes.join(" ");
}
