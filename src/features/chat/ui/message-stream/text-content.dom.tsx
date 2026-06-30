import type { Ref, ComponentChild as UiNode } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { listenDomEvent, listenOutsideDomEvent } from "../../../../shared/ui/dom-events.dom";
import type { MessageStreamTextView } from "../../presentation/message-stream/text-view";
import { MESSAGE_CONTENT_RENDERED_EVENT } from "./content-rendered-event.dom";
import type { TextItemContentContext } from "./context";

const USER_MESSAGE_COLLAPSE_HEIGHT_PX = 360;

export function CollapsibleTextContent({ view, context }: { view: MessageStreamTextView; context: TextItemContentContext }): UiNode {
  const collapseRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const expanded = context.disclosures.userMessageExpanded.has(view.id);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const update = () => {
      setOverflows(content.scrollHeight > userMessageCollapseHeight(content) + 1);
    };
    const disposeRendered = listenDomEvent(content, MESSAGE_CONTENT_RENDERED_EVENT, update);
    update();
    content.win.requestAnimationFrame(update);
    return disposeRendered;
  }, [view.id, view.body, view.renderMode]);

  useEffect(() => {
    if (!overflows || !expanded) return;
    const collapse = collapseRef.current;
    if (!collapse) return;
    return listenOutsideDomEvent(
      collapse,
      "pointerdown",
      () => {
        context.onDisclosureToggle?.("userMessageExpanded", view.id, false);
      },
      true,
    );
  }, [context, expanded, view.id, overflows]);

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
          context.onDisclosureToggle?.("userMessageExpanded", view.id, true);
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
  contentRef?: Ref<HTMLDivElement> | undefined;
  collapsed?: boolean;
}

export function TextContent({ view, context, contentRef, collapsed = false }: TextContentProps): UiNode {
  if (view.renderMode === "text") {
    return (
      <TextContentContainer contentRef={contentRef} collapsed={collapsed}>
        {view.body}
      </TextContentContainer>
    );
  }
  return <MarkdownTextContent view={view} context={context} contentRef={contentRef} collapsed={collapsed} />;
}

function MarkdownTextContent({ view, context, contentRef, collapsed = false }: TextContentProps): UiNode {
  const text = view.body;
  const localRef = useRef<HTMLDivElement | null>(null);
  const contextRef = useRef(context);
  useLayoutEffect(() => {
    contextRef.current = context;
  });
  useLayoutEffect(() => {
    const content = localRef.current;
    if (!content) return;
    const currentContext = contextRef.current;
    if (view.renderMode === "obsidianMarkdown") {
      currentContext.renderObsidianMarkdown(content, text);
    } else {
      currentContext.renderStreamMarkdown(content, text);
    }
  }, [view.renderMode, text]);
  return (
    <TextContentContainer
      contentRef={(element) => {
        localRef.current = element;
        assignTextContentRef(contentRef, element);
      }}
      collapsed={collapsed}
      markdown
    />
  );
}

function TextContentContainer({
  children,
  contentRef,
  collapsed,
  markdown = false,
}: {
  children?: UiNode;
  contentRef?: Ref<HTMLDivElement> | undefined;
  collapsed: boolean;
  markdown?: boolean;
}): UiNode {
  return (
    <div
      ref={(element) => {
        assignTextContentRef(contentRef, element);
      }}
      className={[
        "codex-panel__message-content",
        markdown ? "markdown-rendered" : "",
        collapsed ? "codex-panel__message-content--collapsed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

function assignTextContentRef(contentRef: Ref<HTMLDivElement> | undefined, element: HTMLDivElement | null): void {
  if (typeof contentRef === "function") {
    contentRef(element);
  } else if (contentRef) {
    contentRef.current = element;
  }
}

function userMessageCollapseHeight(element: HTMLElement): number {
  const viewportHeight = element.win.innerHeight;
  if (viewportHeight <= 0) return USER_MESSAGE_COLLAPSE_HEIGHT_PX;
  return Math.min(USER_MESSAGE_COLLAPSE_HEIGHT_PX, viewportHeight * 0.45);
}
