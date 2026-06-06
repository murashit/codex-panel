import { Fragment, type ComponentChild as UiNode, type Ref } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { displayBlocksForItems } from "../display/blocks";
import { executionState } from "../display/state";
import type { ToolResultDisplayItem } from "../display/tool-view";
import type { DisplayBlock, DisplayDetailSection, DisplayItem } from "../display/types";
import { activeTurnId, type ChatTurnLifecycleState } from "../chat-state";
import { IconButton } from "../../../shared/ui/components";
import { MESSAGE_CONTENT_RENDERED_EVENT } from "./message-content-events";
import { toolResultNode } from "./tool-result";
import { activeAgentRunSummaryBlock, agentRunSummaryNode, workItemNode, type WorkItemDisplayItem } from "./work-items";
import type { ChatTurnDiffViewState } from "./turn-diff";
import { renderUiRoot } from "../../../shared/ui/ui-root";

const USER_MESSAGE_COLLAPSE_HEIGHT_PX = 360;

export interface MessageStreamBlock {
  key: string;
  node: UiNode;
}

export interface MessageStreamContext {
  activeThreadId: string | null;
  turnLifecycle: ChatTurnLifecycleState;
  historyCursor: string | null;
  loadingHistory: boolean;
  displayItems: readonly DisplayItem[];
  turnDiffs?: ReadonlyMap<string, string>;
  workspaceRoot?: string | null;
  openDetails: ReadonlySet<string>;
  onDetailsToggle?: (key: string, open: boolean) => void;
  loadOlderTurns: () => void;
  renderMarkdown: (parent: HTMLElement, text: string) => void;
  copyText?: (text: string) => void;
  canImplementPlanItem?: (item: DisplayItem) => boolean;
  onImplementPlanItem?: (item: DisplayItem) => void;
  canRollbackItem?: (item: DisplayItem) => boolean;
  onRollbackItem?: (item: DisplayItem) => void;
  canForkItem?: (item: DisplayItem) => boolean;
  onForkItem?: (item: DisplayItem, archiveSource: boolean) => void;
  openTurnDiff?: (state: ChatTurnDiffViewState) => void;
  pendingRequestsSignature?: string;
  renderPendingRequests?: () => UiNode;
}

export function messageStreamActiveTurnId(context: Pick<MessageStreamContext, "turnLifecycle">): string | null {
  return activeTurnId({ lifecycle: context.turnLifecycle });
}

type RenderableTextItem = Extract<DisplayItem, { kind: "message" | "system" | "userInputResult" }>;
type TextRenderMode = "markdown" | "text";

function isRenderableTextItem(item: DisplayItem): item is RenderableTextItem {
  return item.kind === "message" || item.kind === "system" || item.kind === "userInputResult";
}

function isRenderableToolResultItem(item: DisplayItem): item is ToolResultDisplayItem {
  return (
    item.kind === "command" ||
    item.kind === "fileChange" ||
    item.kind === "goal" ||
    item.kind === "tool" ||
    item.kind === "hook" ||
    item.kind === "reviewResult" ||
    item.kind === "approvalResult"
  );
}

function isRenderableWorkItem(item: DisplayItem): item is WorkItemDisplayItem {
  return item.kind === "taskProgress" || item.kind === "agent" || item.kind === "reasoning" || item.kind === "contextCompaction";
}

function displayItemNode(item: DisplayItem, context: MessageStreamContext): UiNode {
  if (isRenderableTextItem(item)) return <MessageItem item={item} context={context} />;
  if (isRenderableToolResultItem(item)) return toolResultNode(item, context);
  if (isRenderableWorkItem(item)) return workItemNode(item, context);
}

export function messageStreamBlocks(context: MessageStreamContext): MessageStreamBlock[] {
  const blocks: MessageStreamBlock[] = [];
  const activeTurn = messageStreamActiveTurnId(context);

  if (context.activeThreadId && context.historyCursor) {
    blocks.push({
      key: "history-bar",
      node: <HistoryBar loadingHistory={context.loadingHistory} loadOlderTurns={context.loadOlderTurns} />,
    });
  }

  if (context.displayItems.length === 0) {
    blocks.push({
      key: "empty",
      node: <EmptyMessage />,
    });
    return blocks;
  }

  const streamItems = activeTurn ? withoutActiveTaskProgress(context.displayItems, activeTurn) : context.displayItems;
  for (const block of displayBlocksForItems(streamItems, activeTurn, context.workspaceRoot, context.turnDiffs)) {
    if (block.type === "item") {
      blocks.push({
        key: `item:${block.item.id}`,
        node: displayItemNode(block.item, context),
      });
    } else {
      blocks.push({
        key: `activity:${block.id}`,
        node: <ActivityGroup group={block} context={context} />,
      });
    }
  }

  blocks.push(...bottomLiveBlocks(context, activeTurn));

  return blocks;
}

function bottomLiveBlocks(context: MessageStreamContext, activeTurn: string | null): MessageStreamBlock[] {
  const blocks: MessageStreamBlock[] = [];
  if (activeTurn) blocks.push(...activeTurnLiveBlocks(context, activeTurn));

  if (context.renderPendingRequests && context.pendingRequestsSignature) {
    blocks.push({
      key: "pending-requests",
      node: context.renderPendingRequests(),
    });
  }
  return blocks;
}

function activeTurnLiveBlocks(context: MessageStreamContext, activeTurn: string): MessageStreamBlock[] {
  const agentSummaryAnchorId = activeAgentRunSummaryAnchorId(context.displayItems, activeTurn);
  const agentSummary = agentSummaryAnchorId ? activeAgentRunSummaryBlock(context) : null;
  const blocks = context.displayItems.flatMap((item): MessageStreamBlock[] => {
    if (item.kind === "taskProgress" && item.turnId === activeTurn) {
      return [
        {
          key: `live-task:${item.id}`,
          node: workItemNode(item, context),
        },
      ];
    }
    if (item.id === agentSummaryAnchorId) {
      return agentSummary
        ? [
            {
              key: `live-agents:${activeTurn}`,
              node: agentRunSummaryNode(agentSummary),
            },
          ]
        : [];
    }
    return [];
  });
  return blocks;
}

function activeAgentRunSummaryAnchorId(items: readonly DisplayItem[], activeTurn: string): string | null {
  const firstActiveAgent = items.find((item) => item.kind === "agent" && item.turnId === activeTurn);
  return firstActiveAgent?.id ?? null;
}

function withoutActiveTaskProgress(items: readonly DisplayItem[], activeTurn: string): DisplayItem[] {
  return items.filter((item) => item.kind !== "taskProgress" || item.turnId !== activeTurn);
}

export function renderMessageStreamBlocks(parent: HTMLElement, blocks: MessageStreamBlock[]): void {
  renderUiRoot(parent, <MessageStreamBlocks blocks={blocks} />);
}

function MessageStreamBlocks({ blocks }: { blocks: MessageStreamBlock[] }): UiNode {
  return (
    <>
      {blocks.map((block) => (
        <MessageStreamBlockHost key={block.key} block={block} />
      ))}
    </>
  );
}

function MessageStreamBlockHost({ block }: { block: MessageStreamBlock }): UiNode {
  return (
    <div className="codex-panel__message-block" data-codex-panel-block-key={block.key}>
      {block.node}
    </div>
  );
}

function HistoryBar({ loadingHistory, loadOlderTurns }: { loadingHistory: boolean; loadOlderTurns: () => void }): UiNode {
  return (
    <div className="codex-panel__history-bar">
      <button type="button" disabled={loadingHistory} onClick={loadOlderTurns}>
        {loadingHistory ? "Loading..." : "Load older"}
      </button>
    </div>
  );
}

function EmptyMessage(): UiNode {
  return <div className="codex-panel__message codex-panel__message--system">Send a message to start a conversation.</div>;
}

function ActivityGroup({
  group,
  context,
}: {
  group: Extract<DisplayBlock, { type: "activityGroup" }>;
  context: MessageStreamContext;
}): UiNode {
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
      <summary tabIndex={-1}>{group.summary}</summary>
      {group.items.map((item) => (
        <Fragment key={item.id}>{displayItemNode(item, context)}</Fragment>
      ))}
    </details>
  );
}

function MessageItem({ item, context }: { item: RenderableTextItem; context: MessageStreamContext }): UiNode {
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

function MessageRole({ item, context }: { item: RenderableTextItem; context: MessageStreamContext }): UiNode {
  const forkActionsKey = `message:fork-actions:${item.id}`;
  const forkActionsOpen = context.openDetails.has(forkActionsKey);
  const roleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!forkActionsOpen) return;
    const doc = roleRef.current?.ownerDocument;
    if (!doc) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && roleRef.current?.contains(event.target)) return;
      context.onDetailsToggle?.(forkActionsKey, false);
    };
    doc.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      doc.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [context, forkActionsKey, forkActionsOpen]);

  const copyAction =
    item.kind === "message" && context.copyText && isMessageCopyActionVisible(item, context) && !forkActionsOpen ? (
      <MessageAction
        icon="copy"
        label="Copy message"
        className="codex-panel__copy-message"
        onClick={() => context.copyText?.(item.copyText ?? item.text)}
      />
    ) : null;

  return (
    <div ref={roleRef} className={`codex-panel__message-role${forkActionsOpen ? " codex-panel__message-role--fork-open" : ""}`}>
      <span>{displayRoleLabel(item)}</span>
      {forkActionsOpen && context.canForkItem?.(item) ? (
        <MessageAction
          icon="archive"
          label="Fork and archive"
          className="codex-panel__fork-and-archive-message"
          onClick={() => {
            context.onDetailsToggle?.(forkActionsKey, false);
            context.onForkItem?.(item, true);
          }}
        />
      ) : (
        copyAction
      )}
      {context.canForkItem?.(item) ? (
        <MessageAction
          icon="git-fork"
          label={forkActionsOpen ? "Fork" : "Fork from here"}
          className="codex-panel__fork-message"
          onClick={() => {
            if (forkActionsOpen) {
              context.onDetailsToggle?.(forkActionsKey, false);
              context.onForkItem?.(item, false);
            } else {
              context.onDetailsToggle?.(forkActionsKey, true);
            }
          }}
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
}): UiNode {
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

function CollapsibleMessageContent({ item, context }: { item: RenderableTextItem; context: MessageStreamContext }): UiNode {
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
  context: MessageStreamContext;
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

function ReferencedThread({ item }: { item: Extract<DisplayItem, { kind: "message" }> }): UiNode {
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

function EditedFiles({ item, context }: { item: Extract<DisplayItem, { kind: "message" }>; context: MessageStreamContext }): UiNode {
  const editedFiles = item.editedFiles ?? [];
  const label = editedFiles.length === 1 ? "Edited 1 file" : `Edited ${String(editedFiles.length)} files`;
  return (
    <div className="codex-panel__edited-files">
      <details className="codex-panel__edited-files-details">
        <summary tabIndex={-1}>
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

function MentionedFiles({ item, context }: { item: Extract<DisplayItem, { kind: "message" }>; context: MessageStreamContext }): UiNode {
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

function AutoReviewSummaries({ summaries }: { summaries: string[] }): UiNode {
  const label = summaries.length === 1 ? "Auto-reviewed 1 request" : `Auto-reviewed ${String(summaries.length)} requests`;
  return (
    <details className="codex-panel__auto-reviews">
      <summary tabIndex={-1}>{label}</summary>
      <ul>
        {summaries.map((summary, index) => (
          <li key={`${String(index)}:${summary}`}>{summary}</li>
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
}): UiNode {
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

function SystemDetails({ details }: { details: DisplayDetailSection[] }): UiNode {
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

function DetailSectionBody({ section }: { section: DisplayDetailSection }): UiNode {
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
  children: UiNode;
}): UiNode {
  const details = (
    <details
      className={detailsClassName}
      open={context.openDetails.has(detailsKey)}
      onToggle={(event) => {
        context.onDetailsToggle?.(detailsKey, event.currentTarget.open);
      }}
    >
      <summary tabIndex={-1}>{summary}</summary>
      {children}
    </details>
  );
  return wrapperClassName ? <div className={wrapperClassName}>{details}</div> : details;
}

function messageContentKey(item: RenderableTextItem): string {
  return `${item.id}\u001f${contentRenderMode(item)}\u001f${item.text}`;
}

function contentRenderMode(item: RenderableTextItem): TextRenderMode {
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

function displayRoleLabel(item: DisplayItem): string {
  if (item.kind === "approvalResult") return "Approval";
  if (item.kind === "userInputResult") return "Input";
  if (item.kind === "reviewResult") return "Review";
  if (item.role === "user") return "You";
  if (item.role === "assistant") return "Codex";
  return "System";
}

function isMessageCopyActionVisible(item: DisplayItem, context: Pick<MessageStreamContext, "turnLifecycle">): boolean {
  if (item.kind !== "message" || item.copyText === undefined) return false;
  const activeTurn = messageStreamActiveTurnId(context);
  return !(activeTurn && item.role === "assistant" && item.turnId === activeTurn);
}

function messageClass(item: DisplayItem): string {
  const classes = ["codex-panel__message", `codex-panel__message--${item.role}`];
  if (item.kind === "approvalResult") classes.push("codex-panel__message--approval-result");
  if (item.kind === "userInputResult") classes.push("codex-panel__message--user-input-result");
  if (item.kind === "reviewResult") classes.push("codex-panel__message--review-result");
  return classes.join(" ");
}
