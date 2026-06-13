import { type ComponentChild as UiNode, type Ref } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { DisplayItem, ExecutionState } from "../../display/types";
import { timelineItemFromDisplayItem } from "../../display/timeline/from-display";
import { MESSAGE_CONTENT_RENDERED_EVENT } from "./content-events";
import type { TextItemContentContext, TextItemContext, TextDisplayItem } from "./context";
import { TextItemHeader } from "./text-item-actions";
import { AutoReviewSummaries, EditedFiles, MentionedFiles, TextItemDetails, ReferencedThread, SystemDetails } from "./text-item-metadata";

const USER_MESSAGE_COLLAPSE_HEIGHT_PX = 360;

export function textItemNode(item: TextDisplayItem, context: TextItemContext): UiNode {
  return <TextItem item={item} context={context} />;
}

function TextItem({ item, context }: { item: TextDisplayItem; context: TextItemContext }): UiNode {
  const collapsible = isCollapsibleUserMessage(item);
  const details = "details" in item ? item.details : undefined;
  return (
    <div className={`${textItemClass(item)}${executionClassName(item.executionState ?? null)}`}>
      <TextItemHeader item={item} context={context} />
      {collapsible ? (
        <CollapsibleTextItemContent item={item} context={context} />
      ) : (
        <TextContent key={textItemContentKey(item)} item={item} context={context} />
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
        <TextItemDetails displayItemId={item.id} details={details} context={context} />
      ) : null}
    </div>
  );
}

function CollapsibleTextItemContent({ item, context }: { item: TextDisplayItem; context: TextItemContentContext }): UiNode {
  const renderModeKey = contentRenderMode(item);
  const collapseRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const expanded = context.disclosures.userMessageExpanded.has(item.id);

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
      context.onDisclosureToggle?.("userMessageExpanded", item.id, false);
    };
    doc.addEventListener("pointerdown", collapseOnOutsidePointer, true);
    return () => {
      doc.removeEventListener("pointerdown", collapseOnOutsidePointer, true);
    };
  }, [context, expanded, item.id, overflows]);

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
      <TextContent
        key={textItemContentKey(item)}
        item={item}
        context={context}
        contentRef={contentRef}
        collapsed={overflows && !expanded}
      />
      <details
        className="codex-panel__message-collapse-details"
        hidden={!overflows || expanded}
        onToggle={(event) => {
          if (!event.currentTarget.open) return;
          event.currentTarget.open = false;
          context.onDisclosureToggle?.("userMessageExpanded", item.id, true);
        }}
      >
        <summary tabIndex={-1}>Show more</summary>
      </details>
    </div>
  );
}

interface TextContentProps {
  item: TextDisplayItem;
  context: TextItemContentContext;
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

function textItemContentKey(item: TextDisplayItem): string {
  return `${item.id}\u001f${contentRenderMode(item)}`;
}

function contentRenderMode(item: TextDisplayItem): "markdown" | "text" {
  return timelineItemFromDisplayItem(item).detailShape === "markdownText" ? "markdown" : "text";
}

function executionClassName(state: ExecutionState): string {
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

function textItemClass(item: DisplayItem): string {
  const classes = ["codex-panel__message", `codex-panel__message--${item.role}`];
  if (item.kind === "approvalResult") classes.push("codex-panel__message--approval-result");
  if (item.kind === "userInputResult") classes.push("codex-panel__message--user-input-result");
  if (item.kind === "reviewResult") classes.push("codex-panel__message--review-result");
  return classes.join(" ");
}
