import { type ComponentChild as UiNode, type Ref } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { MessageStreamTextView } from "../../presentation/message-stream/text-view";
import { MESSAGE_CONTENT_RENDERED_EVENT } from "./content-events";
import type { TextItemContentContext, TextItemContext } from "./context";
import { TextItemHeader } from "./text-item-actions";
import {
  AutoReviewSummaries,
  EditedFiles,
  MentionedFiles,
  TextItemDetails,
  ReferencedThread,
  SystemDetails,
  userInputQuestionDetails,
} from "./text-item-metadata";

const USER_MESSAGE_COLLAPSE_HEIGHT_PX = 360;

export function textItemNode(view: MessageStreamTextView, context: TextItemContext): UiNode {
  return <TextItem view={view} context={context} />;
}

function TextItem({ view, context }: { view: MessageStreamTextView; context: TextItemContext }): UiNode {
  const { item } = view;
  return (
    <div className={view.className}>
      <TextItemHeader item={item} context={context} />
      {view.collapsible ? (
        <CollapsibleTextItemContent view={view} context={context} />
      ) : (
        <TextContent key={view.contentKey} view={view} context={context} />
      )}
      {item.kind === "message" && view.editedFiles.length > 0 ? (
        <EditedFiles item={item} context={context} {...definedProp("annotations", view.annotations)} />
      ) : null}
      {item.kind === "message" && item.referencedThread ? <ReferencedThread item={item} /> : null}
      {item.kind === "message" && item.mentionedFiles && item.mentionedFiles.length > 0 ? (
        <MentionedFiles item={item} context={context} />
      ) : null}
      {item.kind === "message" && view.autoReviewSummaries.length > 0 ? (
        <AutoReviewSummaries summaries={[...view.autoReviewSummaries]} />
      ) : null}
      {item.kind === "system" && item.noticeSections && item.noticeSections.length > 0 ? (
        <SystemDetails details={item.noticeSections} />
      ) : item.kind === "userInputResult" && item.questions.length > 0 ? (
        <TextItemDetails itemId={item.id} details={userInputQuestionDetails(item.questions)} context={context} />
      ) : null}
    </div>
  );
}

function CollapsibleTextItemContent({ view, context }: { view: MessageStreamTextView; context: TextItemContentContext }): UiNode {
  const { item } = view;
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
  }, [item.id, item.text, view.contentMode]);

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
      <TextContent key={view.contentKey} view={view} context={context} contentRef={contentRef} collapsed={overflows && !expanded} />
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
  view: MessageStreamTextView;
  context: TextItemContentContext;
  contentRef?: Ref<HTMLDivElement>;
  collapsed?: boolean;
}

function TextContent({ view, context, contentRef, collapsed = false }: TextContentProps): UiNode {
  const rendersMarkdown = view.contentMode === "markdown";
  const { item } = view;
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
  }, [view.contentMode, rendersMarkdown, text]);
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

function userMessageCollapseHeight(element: HTMLElement): number {
  const viewportHeight = element.win.innerHeight;
  if (viewportHeight <= 0) return USER_MESSAGE_COLLAPSE_HEIGHT_PX;
  return Math.min(USER_MESSAGE_COLLAPSE_HEIGHT_PX, viewportHeight * 0.45);
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
