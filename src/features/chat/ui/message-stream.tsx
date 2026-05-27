import { Fragment, useLayoutEffect, useRef, useState, type Ref, type ReactNode } from "react";

import { displayBlocksForItems } from "../display/blocks";
import { displayItemSignature, isMessageCopyActionVisible } from "../display/signature";
import { executionState } from "../display/state";
import type { ToolResultDisplayItem } from "../display/tool-view";
import type { DisplayBlock, DisplayDetailSection, DisplayItem } from "../display/types";
import { createIconButton, createMetaPair, createRememberedDetails } from "../../../shared/ui/components";
import { shortSignature } from "../../../shared/ui/dom";
import { IconButton } from "../../../shared/ui/react-components";
import { applyExecutionStateClass } from "./execution-state";
import { renderToolResult, toolResultNode } from "./tool-result";
import {
  activeAgentRunSummaryBlock,
  agentRunSummaryNode,
  createAgentRunSummaryElement,
  renderAgentItem,
  renderReasoningItem,
  renderTaskProgressItem,
  workItemNode,
  type WorkItemDisplayItem,
} from "./work-items";
import type { ChatTurnDiffViewState } from "./turn-diff";
import { renderReactRoot } from "../../../shared/ui/react-root";

const USER_MESSAGE_COLLAPSE_HEIGHT_PX = 360;
const MESSAGE_CONTENT_RENDERED_EVENT = "codex-panel:message-content-rendered";

export interface MessageRenderBlock {
  key: string;
  signature: string;
  render: () => HTMLElement;
  node?: ReactNode;
}

export interface MessageStreamContext {
  activeThreadId: string | null;
  activeTurnId: string | null;
  historyCursor: string | null;
  loadingHistory: boolean;
  busy: boolean;
  displayItems: DisplayItem[];
  turnDiffs?: ReadonlyMap<string, string>;
  workspaceRoot?: string | null;
  openDetails: Set<string>;
  onDetailsToggle?: (key: string, open: boolean) => void;
  loadOlderTurns: () => void;
  renderMarkdown: (parent: HTMLElement, text: string) => void;
  renderTextWithWikiLinks: (parent: HTMLElement, text: string) => void;
  copyText?: (text: string) => void;
  canImplementPlanItem?: (item: DisplayItem) => boolean;
  onImplementPlanItem?: (item: DisplayItem) => void;
  canRollbackItem?: (item: DisplayItem) => boolean;
  onRollbackItem?: (item: DisplayItem) => void;
  openTurnDiff?: (state: ChatTurnDiffViewState) => void;
  pendingRequestsSignature?: string;
  renderPendingRequests?: () => ReactNode;
}

type RenderableMessageItem = Extract<DisplayItem, { kind: "message" | "system" | "userInputResult" }>;

function isRenderableMessageItem(item: DisplayItem): item is RenderableMessageItem {
  return item.kind === "message" || item.kind === "system" || item.kind === "userInputResult";
}

function isRenderableToolResultItem(item: DisplayItem): item is ToolResultDisplayItem {
  return (
    item.kind === "command" ||
    item.kind === "fileChange" ||
    item.kind === "tool" ||
    item.kind === "hook" ||
    item.kind === "reviewResult" ||
    item.kind === "approvalResult"
  );
}

function isRenderableWorkItem(item: DisplayItem): item is WorkItemDisplayItem {
  return item.kind === "taskProgress" || item.kind === "agent" || item.kind === "reasoning";
}

function displayItemNode(item: DisplayItem, context: MessageStreamContext): ReactNode | undefined {
  if (isRenderableMessageItem(item)) return <MessageItem item={item} context={context} />;
  if (isRenderableToolResultItem(item)) return toolResultNode(item, context);
  if (isRenderableWorkItem(item)) return workItemNode(item, context);
  return undefined;
}

export function messageRenderBlocks(context: MessageStreamContext): MessageRenderBlock[] {
  const blocks: MessageRenderBlock[] = [];

  if (context.activeThreadId && context.historyCursor) {
    blocks.push({
      key: "history-bar",
      signature: `${context.activeThreadId}:${context.historyCursor}:${String(context.loadingHistory)}`,
      render: () => createHistoryBarElement(context.loadingHistory, context.loadOlderTurns),
      node: <HistoryBar loadingHistory={context.loadingHistory} loadOlderTurns={context.loadOlderTurns} />,
    });
  }

  if (context.displayItems.length === 0) {
    blocks.push({
      key: "empty",
      signature: "empty",
      render: () =>
        createDiv({
          cls: "codex-panel__message codex-panel__message--system",
          text: "Send a message to start a new thread.",
        }),
      node: <EmptyMessage />,
    });
    return blocks;
  }

  for (const block of displayBlocksForItems(context.displayItems, context.activeTurnId, context.workspaceRoot, context.turnDiffs)) {
    if (block.type === "item") {
      const node = displayItemNode(block.item, context);
      blocks.push({
        key: `item:${block.item.id}`,
        signature: displayItemSignature(block.item, context),
        render: () => createDisplayItemElement(block.item, context),
        ...(node === undefined ? {} : { node }),
      });
    } else {
      blocks.push({
        key: `activity:${block.id}`,
        signature: `${block.summary}\n${block.items.map((item) => displayItemSignature(item, context)).join("\n")}`,
        render: () => createActivityGroupElement(block, context),
        node: <ActivityGroup group={block} context={context} />,
      });
    }
  }

  const agentSummary = activeAgentRunSummaryBlock(context);
  if (agentSummary) {
    blocks.push({
      key: `active-agents:${context.activeTurnId ?? "none"}`,
      signature: JSON.stringify(agentSummary),
      render: () => createAgentRunSummaryElement(agentSummary),
      node: agentRunSummaryNode(agentSummary),
    });
  }

  if (context.renderPendingRequests && context.pendingRequestsSignature) {
    blocks.push({
      key: "pending-requests",
      signature: context.pendingRequestsSignature,
      render: () => createDiv(),
      node: context.renderPendingRequests(),
    });
  }

  return blocks;
}

export function renderMessageRenderBlocks(parent: HTMLElement, blocks: MessageRenderBlock[], signatures: Map<string, string>): void {
  renderReactRoot(parent, <MessageRenderBlocks blocks={blocks} signatures={signatures} />);
}

function MessageRenderBlocks({ blocks, signatures }: { blocks: MessageRenderBlock[]; signatures: Map<string, string> }): ReactNode {
  return (
    <>
      {blocks.map((block) => (
        <MessageRenderBlockHost key={block.key} block={block} signatures={signatures} />
      ))}
    </>
  );
}

function MessageRenderBlockHost({ block, signatures }: { block: MessageRenderBlock; signatures: Map<string, string> }): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    if (block.node !== undefined) {
      signatures.set(block.key, block.signature);
      host.dataset["codexPanelBlockSignature"] = shortSignature(block.signature);
      return;
    }
    if (signatures.get(block.key) !== block.signature) {
      host.replaceChildren(block.render());
      signatures.set(block.key, block.signature);
    }
    host.dataset["codexPanelBlockSignature"] = shortSignature(block.signature);
  }, [block, signatures]);

  useLayoutEffect(() => {
    const key = block.key;
    return () => {
      signatures.delete(key);
    };
  }, [block.key, signatures]);

  return (
    <div ref={ref} className="codex-panel__message-block" data-codex-panel-block-key={block.key}>
      {block.node}
    </div>
  );
}

function HistoryBar({ loadingHistory, loadOlderTurns }: { loadingHistory: boolean; loadOlderTurns: () => void }): ReactNode {
  return (
    <div className="codex-panel__history-bar">
      <button type="button" disabled={loadingHistory} onClick={loadOlderTurns}>
        {loadingHistory ? "Loading..." : "Load older"}
      </button>
    </div>
  );
}

function EmptyMessage(): ReactNode {
  return <div className="codex-panel__message codex-panel__message--system">Send a message to start a new thread.</div>;
}

function ActivityGroup({
  group,
  context,
}: {
  group: Extract<DisplayBlock, { type: "activityGroup" }>;
  context: MessageStreamContext;
}): ReactNode {
  const detailsKey = `turn:${group.turnId}:activity`;
  const [open, setOpen] = useState(context.openDetails.has(detailsKey));

  useLayoutEffect(() => {
    setOpen(context.openDetails.has(detailsKey));
  }, [context.openDetails, detailsKey]);

  return (
    <details
      className="codex-panel__activity-group"
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        context.onDetailsToggle?.(detailsKey, nextOpen);
      }}
    >
      <summary>{group.summary}</summary>
      {group.items.map((item) => (
        <Fragment key={item.id}>{displayItemNode(item, context)}</Fragment>
      ))}
    </details>
  );
}

function MessageItem({ item, context }: { item: RenderableMessageItem; context: MessageStreamContext }): ReactNode {
  const collapsible = isCollapsibleUserMessage(item);
  const details = "details" in item ? item.details : undefined;
  return (
    <div className={`${messageClass(item)}${executionClassName(executionState(item))}`}>
      <MessageRole item={item} context={context} />
      {collapsible ? (
        <CollapsibleMessageContent item={item} context={context} />
      ) : (
        <MarkdownContent key={messageContentKey(item)} item={item} context={context} />
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

function MessageRole({ item, context }: { item: RenderableMessageItem; context: MessageStreamContext }): ReactNode {
  return (
    <div className="codex-panel__message-role">
      <span>{displayRoleLabel(item)}</span>
      {item.kind === "message" && context.copyText && isMessageCopyActionVisible(item, context) ? (
        <MessageAction
          icon="copy"
          label="Copy message"
          className="codex-panel__copy-message"
          onClick={() => context.copyText?.(item.copyText ?? item.text)}
        />
      ) : null}
      {context.canImplementPlanItem?.(item) ? (
        <MessageAction
          icon="play"
          label="Implement plan"
          className="codex-panel__implement-plan"
          onClick={() => context.onImplementPlanItem?.(item)}
        />
      ) : null}
      {context.canRollbackItem?.(item) ? (
        <MessageAction
          icon="undo-2"
          label="Rollback last turn"
          className="codex-panel__rollback-turn"
          onClick={() => context.onRollbackItem?.(item)}
        />
      ) : null}
    </div>
  );
}

function MessageAction({
  icon,
  label,
  className,
  onClick,
}: {
  icon: string;
  label: string;
  className: string;
  onClick: () => void;
}): ReactNode {
  return (
    <IconButton
      icon={icon}
      label={label}
      className={`clickable-icon codex-panel__message-action ${className}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    />
  );
}

function CollapsibleMessageContent({ item, context }: { item: RenderableMessageItem; context: MessageStreamContext }): ReactNode {
  const key = `message:${item.id}:expanded`;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const expanded = context.openDetails.has(key);

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
  }, [item.id, item.text, item.markdown]);

  return (
    <div
      className={[
        "codex-panel__message-collapse",
        overflows ? "codex-panel__message-collapse--overflow" : "",
        overflows && expanded ? "codex-panel__message-collapse--expanded" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <MarkdownContent key={messageContentKey(item)} item={item} context={context} ref={contentRef} collapsed={overflows && !expanded} />
      <details
        className="codex-panel__message-collapse-details"
        hidden={!overflows || expanded}
        onToggle={(event) => {
          if (!event.currentTarget.open) return;
          event.currentTarget.open = false;
          context.onDetailsToggle?.(key, true);
        }}
      >
        <summary>Show more</summary>
      </details>
    </div>
  );
}

function MarkdownContent({
  item,
  context,
  collapsed = false,
  ref,
}: {
  item: RenderableMessageItem;
  context: MessageStreamContext;
  collapsed?: boolean;
  ref?: Ref<HTMLDivElement>;
}): ReactNode {
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
    if (item.markdown === false) {
      currentContext.renderTextWithWikiLinks(content, item.text);
    } else {
      currentContext.renderMarkdown(content, item.text);
    }
  }, [item.markdown, item.text]);
  return (
    <div
      ref={(element) => {
        localRef.current = element;
        if (typeof ref === "function") {
          ref(element);
        } else if (ref) {
          ref.current = element;
        }
      }}
      className={[
        "codex-panel__message-content",
        item.markdown === false ? "" : "markdown-rendered",
        collapsed ? "codex-panel__message-content--collapsed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

function ReferencedThread({ item }: { item: Extract<DisplayItem, { kind: "message" }> }): ReactNode {
  const reference = item.referencedThread;
  if (!reference) return null;
  return (
    <div className="codex-panel__referenced-thread">
      <span className="codex-panel__referenced-thread-label">
        <span>Referenced </span>
        <span>{reference.title}</span>
        <span className="codex-panel__edited-files-separator">·</span>
        <span>
          {reference.includedTurns}/{reference.turnLimit} turns
        </span>
      </span>
    </div>
  );
}

function EditedFiles({ item, context }: { item: Extract<DisplayItem, { kind: "message" }>; context: MessageStreamContext }): ReactNode {
  const editedFiles = item.editedFiles ?? [];
  const label = editedFiles.length === 1 ? "Edited 1 file" : `Edited ${String(editedFiles.length)} files`;
  return (
    <div className="codex-panel__edited-files">
      <details className="codex-panel__edited-files-details">
        <summary>
          <span className="codex-panel__edited-files-summary">
            <span>{label}</span>
            {item.turnDiff && item.turnId && context.activeThreadId && context.openTurnDiff ? (
              <>
                <span className="codex-panel__edited-files-separator">·</span>
                <IconButton
                  icon="file-diff"
                  label="View diff"
                  className="clickable-icon codex-panel__open-turn-diff"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    context.openTurnDiff?.({
                      threadId: context.activeThreadId ?? "",
                      turnId: item.turnId ?? "",
                      cwd: context.workspaceRoot ?? null,
                      files: editedFiles,
                      diff: item.turnDiff?.diff ?? "",
                    });
                  }}
                >
                  <span className="codex-panel__open-turn-diff-label">View diff</span>
                </IconButton>
              </>
            ) : null}
          </span>
        </summary>
        <ul>
          {editedFiles.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function MentionedFiles({ item, context }: { item: Extract<DisplayItem, { kind: "message" }>; context: MessageStreamContext }): ReactNode {
  const mentionedFiles = item.mentionedFiles ?? [];
  const label = mentionedFiles.length === 1 ? "Mentioned 1 file" : `Mentioned ${String(mentionedFiles.length)} files`;
  return (
    <RememberedDetails
      wrapperClassName="codex-panel__mentioned-files"
      detailsClassName="codex-panel__mentioned-files-details"
      detailsKey={`${item.id}:mentioned-files`}
      summary={label}
      context={context}
    >
      <ul>
        {mentionedFiles.map((file) => (
          <li key={`${file.name}\n${file.path}`}>
            <span>{file.name}</span>
            <span className="codex-panel__edited-files-separator"> · </span>
            <span>{file.path}</span>
          </li>
        ))}
      </ul>
    </RememberedDetails>
  );
}

function AutoReviewSummaries({ summaries }: { summaries: string[] }): ReactNode {
  const label = summaries.length === 1 ? "Auto-reviewed 1 request" : `Auto-reviewed ${String(summaries.length)} requests`;
  return (
    <details className="codex-panel__auto-reviews">
      <summary>{label}</summary>
      <ul>
        {summaries.map((summary) => (
          <li key={summary}>{summary}</li>
        ))}
      </ul>
    </details>
  );
}

function MessageDetails({
  itemId,
  details,
  context,
}: {
  itemId: string;
  details: DisplayDetailSection[];
  context: MessageStreamContext;
}): ReactNode {
  return (
    <>
      {details.map((section, index) => (
        <RememberedDetails
          key={`${section.title ?? "Details"}:${String(index)}`}
          detailsClassName="codex-panel__output"
          detailsKey={`${itemId}:message-detail:${String(index)}`}
          summary={section.title ?? "Details"}
          context={context}
        >
          <DetailSectionBody section={section} />
        </RememberedDetails>
      ))}
    </>
  );
}

function SystemDetails({ details }: { details: DisplayDetailSection[] }): ReactNode {
  return (
    <>
      {details.map((section, index) => (
        <div key={`${section.title ?? ""}:${String(index)}`} className="codex-panel__output codex-panel__system-result-section">
          {section.title ? <div className="codex-panel__output-title">{section.title}</div> : null}
          <DetailSectionBody section={section} />
        </div>
      ))}
    </>
  );
}

function DetailSectionBody({ section }: { section: DisplayDetailSection }): ReactNode {
  return (
    <>
      {section.rows && section.rows.length > 0 ? (
        <dl className="codex-panel__meta-grid">
          {section.rows.map((row) => (
            <Fragment key={`${row.key}\n${row.value}`}>
              <dt>{row.key}</dt>
              <dd>{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      {section.body ? <pre>{section.body}</pre> : null}
    </>
  );
}

function RememberedDetails({
  wrapperClassName,
  detailsClassName,
  detailsKey,
  summary,
  context,
  children,
}: {
  wrapperClassName?: string;
  detailsClassName: string;
  detailsKey: string;
  summary: string;
  context: MessageStreamContext;
  children: ReactNode;
}): ReactNode {
  const details = (
    <details
      className={detailsClassName}
      open={context.openDetails.has(detailsKey)}
      onToggle={(event) => {
        context.onDetailsToggle?.(detailsKey, event.currentTarget.open);
      }}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  );
  return wrapperClassName ? <div className={wrapperClassName}>{details}</div> : details;
}

function messageContentKey(item: RenderableMessageItem): string {
  return `${item.id}\u001f${item.markdown === false ? "text" : "markdown"}\u001f${item.text}`;
}

function executionClassName(state: ReturnType<typeof executionState>): string {
  return state ? ` codex-panel__execution codex-panel__execution--${state}` : "";
}

function createHistoryBarElement(loadingHistory: boolean, loadOlderTurns: () => void): HTMLElement {
  const historyBar = createDiv({ cls: "codex-panel__history-bar" });
  const loadOlder = historyBar.createEl("button", {
    text: loadingHistory ? "Loading..." : "Load older",
  });
  loadOlder.disabled = loadingHistory;
  loadOlder.onclick = loadOlderTurns;
  return historyBar;
}

function createDisplayItemElement(item: DisplayItem, context: MessageStreamContext): HTMLElement {
  const container = createDiv();
  renderDisplayItem(container, item, context);
  return container.firstElementChild as HTMLElement;
}

function createActivityGroupElement(group: Extract<DisplayBlock, { type: "activityGroup" }>, context: MessageStreamContext): HTMLElement {
  const container = createDiv();
  const details = createRememberedDetails(
    container,
    context.openDetails,
    `turn:${group.turnId}:activity`,
    "codex-panel__activity-group",
    group.summary,
    false,
    context.onDetailsToggle,
  );
  for (const item of group.items) {
    renderDisplayItem(details, item, context);
  }
  return container.firstElementChild as HTMLElement;
}

function renderDisplayItem(parent: HTMLElement, item: DisplayItem, context: MessageStreamContext): void {
  if (item.kind === "command") {
    renderToolResult(parent, item, context);
    return;
  }
  if (item.kind === "fileChange") {
    renderToolResult(parent, item, context);
    return;
  }
  if (item.kind === "taskProgress") {
    renderTaskProgressItem(parent, item);
    return;
  }
  if (item.kind === "agent") {
    renderAgentItem(parent, item, context);
    return;
  }
  if (item.kind === "reasoning") {
    renderReasoningItem(parent, item, context);
    return;
  }
  if (item.kind === "tool" || item.kind === "hook") {
    renderToolResult(parent, item, context);
    return;
  }
  if (item.kind === "reviewResult") {
    renderToolResult(parent, item, context);
    return;
  }
  if (item.kind === "approvalResult") {
    renderToolResult(parent, item, context);
    return;
  }
  if (!isRenderableMessageItem(item)) {
    return;
  }
  const messageEl = parent.createDiv({ cls: messageClass(item) });
  applyExecutionStateClass(messageEl, executionState(item));
  const role = messageEl.createDiv({ cls: "codex-panel__message-role" });
  role.createSpan({ text: displayRoleLabel(item) });
  if (item.kind === "message" && context.copyText && isMessageCopyActionVisible(item, context)) {
    renderMessageAction(role, "copy", "Copy message", "codex-panel__copy-message", () => context.copyText?.(item.copyText ?? item.text));
  }
  if (context.canImplementPlanItem?.(item)) {
    renderMessageAction(role, "play", "Implement plan", "codex-panel__implement-plan", () => context.onImplementPlanItem?.(item));
  }
  if (context.canRollbackItem?.(item)) {
    renderMessageAction(role, "undo-2", "Rollback last turn", "codex-panel__rollback-turn", () => context.onRollbackItem?.(item));
  }
  const collapsible = isCollapsibleUserMessage(item);
  const contentParent = collapsible ? messageEl.createDiv({ cls: "codex-panel__message-collapse" }) : messageEl;
  const content = contentParent.createDiv({ cls: `codex-panel__message-content ${item.markdown === false ? "" : "markdown-rendered"}` });
  if (item.markdown === false) {
    context.renderTextWithWikiLinks(content, item.text);
  } else {
    context.renderMarkdown(content, item.text);
  }
  if (collapsible) {
    renderUserMessageCollapse(contentParent, content, item.id, context);
  }
  if (item.kind === "message" && item.editedFiles && item.editedFiles.length > 0) {
    renderEditedFiles(messageEl, item, context);
  }
  if (item.kind === "message" && item.referencedThread) {
    renderReferencedThread(messageEl, item);
  }
  if (item.kind === "message" && item.mentionedFiles && item.mentionedFiles.length > 0) {
    renderMentionedFiles(messageEl, item, context);
  }
  if (item.kind === "message" && item.autoReviewSummaries && item.autoReviewSummaries.length > 0) {
    renderAutoReviewSummaries(messageEl, item.autoReviewSummaries);
  }
  if (item.kind === "system" && item.details && item.details.length > 0) {
    renderSystemDetails(messageEl, item.details);
  } else {
    const details = "details" in item ? item.details : undefined;
    if (details && details.length > 0) {
      renderMessageDetails(messageEl, item.id, details, context);
    }
  }
}

function isCollapsibleUserMessage(item: DisplayItem): boolean {
  return item.kind === "message" && item.role === "user";
}

function renderUserMessageCollapse(parent: HTMLElement, content: HTMLElement, itemId: string, context: MessageStreamContext): void {
  const key = `message:${itemId}:expanded`;
  const details = parent.createEl("details", { cls: "codex-panel__message-collapse-details" });
  details.createEl("summary", { text: "Show more" });

  const update = () => {
    const overflows = content.scrollHeight > userMessageCollapseHeight(content) + 1;
    const expanded = context.openDetails.has(key);
    parent.classList.toggle("codex-panel__message-collapse--overflow", overflows);
    parent.classList.toggle("codex-panel__message-collapse--expanded", overflows && expanded);
    content.classList.toggle("codex-panel__message-content--collapsed", overflows && !expanded);
    details.hidden = !overflows || expanded;
  };

  details.ontoggle = () => {
    if (!details.open) return;
    details.open = false;
    context.onDetailsToggle?.(key, true);
    update();
  };

  content.addEventListener(MESSAGE_CONTENT_RENDERED_EVENT, update);
  update();
  content.win.requestAnimationFrame(update);
}

function userMessageCollapseHeight(element: HTMLElement): number {
  const viewportHeight = element.win.innerHeight;
  if (viewportHeight <= 0) return USER_MESSAGE_COLLAPSE_HEIGHT_PX;
  return Math.min(USER_MESSAGE_COLLAPSE_HEIGHT_PX, viewportHeight * 0.45);
}

function renderMessageAction(parent: HTMLElement, icon: string, label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = createIconButton(parent, icon, label, `codex-panel__message-action ${className}`);
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  };
  return button;
}

function renderReferencedThread(parent: HTMLElement, item: Extract<DisplayItem, { kind: "message" }>): void {
  const reference = item.referencedThread;
  if (!reference) return;
  const wrapper = parent.createDiv({ cls: "codex-panel__referenced-thread" });
  const label = wrapper.createSpan({ cls: "codex-panel__referenced-thread-label" });
  label.createSpan({ text: "Referenced " });
  label.createSpan({ text: reference.title });
  label.createSpan({ cls: "codex-panel__edited-files-separator", text: "·" });
  label.createSpan({ text: `${String(reference.includedTurns)}/${String(reference.turnLimit)} turns` });
}

function renderEditedFiles(parent: HTMLElement, item: Extract<DisplayItem, { kind: "message" }>, context: MessageStreamContext): void {
  const editedFiles = item.editedFiles ?? [];
  const label = editedFiles.length === 1 ? "Edited 1 file" : `Edited ${String(editedFiles.length)} files`;
  const wrapper = parent.createDiv({ cls: "codex-panel__edited-files" });
  const details = wrapper.createEl("details", { cls: "codex-panel__edited-files-details" });
  const summary = details.createEl("summary");
  const summaryContent = summary.createSpan({ cls: "codex-panel__edited-files-summary" });
  summaryContent.createSpan({ text: label });
  if (item.turnDiff && item.turnId && context.activeThreadId && context.openTurnDiff) {
    summaryContent.createSpan({ cls: "codex-panel__edited-files-separator", text: "·" });
    const button = createIconButton(summaryContent, "file-diff", "View diff", "codex-panel__open-turn-diff");
    button.createSpan({ cls: "codex-panel__open-turn-diff-label", text: "View diff" });
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      context.openTurnDiff?.({
        threadId: context.activeThreadId ?? "",
        turnId: item.turnId ?? "",
        cwd: context.workspaceRoot ?? null,
        files: editedFiles,
        diff: item.turnDiff?.diff ?? "",
      });
    };
  }
  const list = details.createEl("ul");
  for (const file of editedFiles) {
    list.createEl("li", { text: file });
  }
}

export function notifyMessageContentRendered(element: HTMLElement): void {
  element.dispatchEvent(new Event(MESSAGE_CONTENT_RENDERED_EVENT));
}

function renderMentionedFiles(parent: HTMLElement, item: Extract<DisplayItem, { kind: "message" }>, context: MessageStreamContext): void {
  const mentionedFiles = item.mentionedFiles ?? [];
  const label = mentionedFiles.length === 1 ? "Mentioned 1 file" : `Mentioned ${String(mentionedFiles.length)} files`;
  const wrapper = parent.createDiv({ cls: "codex-panel__mentioned-files" });
  const details = createRememberedDetails(
    wrapper,
    context.openDetails,
    `${item.id}:mentioned-files`,
    "codex-panel__mentioned-files-details",
    label,
    false,
    context.onDetailsToggle,
  );
  const list = details.createEl("ul");
  for (const file of mentionedFiles) {
    const row = list.createEl("li");
    row.createSpan({ text: file.name });
    row.createSpan({ cls: "codex-panel__edited-files-separator", text: " · " });
    row.createSpan({ text: file.path });
  }
}

function renderAutoReviewSummaries(parent: HTMLElement, summaries: string[]): void {
  const label = summaries.length === 1 ? "Auto-reviewed 1 request" : `Auto-reviewed ${String(summaries.length)} requests`;
  const details = parent.createEl("details", { cls: "codex-panel__auto-reviews" });
  details.createEl("summary", { text: label });
  const list = details.createEl("ul");
  for (const summary of summaries) {
    list.createEl("li", { text: summary });
  }
}

function displayRoleLabel(item: DisplayItem): string {
  if (item.kind === "approvalResult") return "Approval";
  if (item.kind === "userInputResult") return "Input";
  if (item.kind === "reviewResult") return "Review";
  if (item.role === "user") return "You";
  if (item.role === "assistant") return "Codex";
  return "System";
}

function messageClass(item: DisplayItem): string {
  const classes = ["codex-panel__message", `codex-panel__message--${item.role}`];
  if (item.kind === "approvalResult") classes.push("codex-panel__message--approval-result");
  if (item.kind === "userInputResult") classes.push("codex-panel__message--user-input-result");
  if (item.kind === "reviewResult") classes.push("codex-panel__message--review-result");
  return classes.join(" ");
}

function renderMessageDetails(parent: HTMLElement, itemId: string, details: DisplayDetailSection[], context: MessageStreamContext): void {
  for (const [index, section] of details.entries()) {
    const summary = section.title ?? "Details";
    const detailsEl = createRememberedDetails(
      parent,
      context.openDetails,
      `${itemId}:message-detail:${String(index)}`,
      "codex-panel__output",
      summary,
      false,
      context.onDetailsToggle,
    );
    if (section.rows && section.rows.length > 0) {
      const rows = detailsEl.createEl("dl", { cls: "codex-panel__meta-grid" });
      for (const row of section.rows) {
        createMetaPair(rows, row.key, row.value);
      }
    }
    if (section.body) detailsEl.createEl("pre", { text: section.body });
  }
}

function renderSystemDetails(parent: HTMLElement, details: DisplayDetailSection[]): void {
  for (const section of details) {
    const sectionEl = parent.createDiv({ cls: "codex-panel__output codex-panel__system-result-section" });
    if (section.title) sectionEl.createDiv({ cls: "codex-panel__output-title", text: section.title });
    if (section.rows && section.rows.length > 0) {
      const rows = sectionEl.createEl("dl", { cls: "codex-panel__meta-grid" });
      for (const row of section.rows) {
        createMetaPair(rows, row.key, row.value);
      }
    }
    if (section.body) sectionEl.createEl("pre", { text: section.body });
  }
}
