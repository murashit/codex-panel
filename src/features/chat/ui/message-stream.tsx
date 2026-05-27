import { Fragment, useLayoutEffect, useRef, useState, type Ref, type ReactNode } from "react";

import { displayBlocksForItems } from "../display/blocks";
import { displayItemSignature, isMessageCopyActionVisible } from "../display/signature";
import { executionState } from "../display/state";
import type { ToolResultDisplayItem } from "../display/tool-view";
import type { DisplayBlock, DisplayDetailSection, DisplayItem } from "../display/types";
import { shortSignature } from "../../../shared/ui/dom";
import { IconButton } from "../../../shared/ui/react-components";
import { toolResultNode } from "./tool-result";
import { activeAgentRunSummaryBlock, agentRunSummaryNode, workItemNode, type WorkItemDisplayItem } from "./work-items";
import type { ChatTurnDiffViewState } from "./turn-diff";
import { renderReactRoot } from "../../../shared/ui/react-root";

const USER_MESSAGE_COLLAPSE_HEIGHT_PX = 360;
const MESSAGE_CONTENT_RENDERED_EVENT = "codex-panel:message-content-rendered";

export interface MessageRenderBlock {
  key: string;
  signature: string;
  node: ReactNode;
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

function displayItemNode(item: DisplayItem, context: MessageStreamContext): ReactNode {
  if (isRenderableMessageItem(item)) return <MessageItem item={item} context={context} />;
  if (isRenderableToolResultItem(item)) return toolResultNode(item, context);
  if (isRenderableWorkItem(item)) return workItemNode(item, context);
}

export function messageRenderBlocks(context: MessageStreamContext): MessageRenderBlock[] {
  const blocks: MessageRenderBlock[] = [];

  if (context.activeThreadId && context.historyCursor) {
    blocks.push({
      key: "history-bar",
      signature: `${context.activeThreadId}:${context.historyCursor}:${String(context.loadingHistory)}`,
      node: <HistoryBar loadingHistory={context.loadingHistory} loadOlderTurns={context.loadOlderTurns} />,
    });
  }

  if (context.displayItems.length === 0) {
    blocks.push({
      key: "empty",
      signature: "empty",
      node: <EmptyMessage />,
    });
    return blocks;
  }

  for (const block of displayBlocksForItems(context.displayItems, context.activeTurnId, context.workspaceRoot, context.turnDiffs)) {
    if (block.type === "item") {
      blocks.push({
        key: `item:${block.item.id}`,
        signature: displayItemSignature(block.item, context),
        node: displayItemNode(block.item, context),
      });
    } else {
      blocks.push({
        key: `activity:${block.id}`,
        signature: `${block.summary}\n${block.items.map((item) => displayItemSignature(item, context)).join("\n")}`,
        node: <ActivityGroup group={block} context={context} />,
      });
    }
  }

  const agentSummary = activeAgentRunSummaryBlock(context);
  if (agentSummary) {
    blocks.push({
      key: `active-agents:${context.activeTurnId ?? "none"}`,
      signature: JSON.stringify(agentSummary),
      node: agentRunSummaryNode(agentSummary),
    });
  }

  if (context.renderPendingRequests && context.pendingRequestsSignature) {
    blocks.push({
      key: "pending-requests",
      signature: context.pendingRequestsSignature,
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
    signatures.set(block.key, block.signature);
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
          setExpanded(true);
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

function isCollapsibleUserMessage(item: DisplayItem): boolean {
  return item.kind === "message" && item.role === "user";
}

function userMessageCollapseHeight(element: HTMLElement): number {
  const viewportHeight = element.win.innerHeight;
  if (viewportHeight <= 0) return USER_MESSAGE_COLLAPSE_HEIGHT_PX;
  return Math.min(USER_MESSAGE_COLLAPSE_HEIGHT_PX, viewportHeight * 0.45);
}

export function notifyMessageContentRendered(element: HTMLElement): void {
  element.dispatchEvent(new Event(MESSAGE_CONTENT_RENDERED_EVENT));
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
