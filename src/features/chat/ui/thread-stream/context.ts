import type { ApprovalAction, McpElicitationAction, PendingRequestId } from "../../../../domain/pending-requests/model";
import type { TurnDiffViewState } from "../../../turn-diff/model";
import type { PlanImplementationTarget } from "../../domain/thread-stream/selectors";
import type { PendingRequestBlockSnapshot } from "../../presentation/pending-requests/view-model";
import type { ThreadStreamForkTarget } from "../../presentation/thread-stream/text-view";

export type ThreadStreamDisclosureBucket = "details" | "activityGroups" | "textDetails" | "userMessageExpanded" | "approvalDetails";

export interface ThreadStreamDisclosureState {
  details: ReadonlySet<string>;
  activityGroups: ReadonlySet<string>;
  textDetails: ReadonlySet<string>;
  userMessageExpanded: ReadonlySet<string>;
  approvalDetails: ReadonlySet<string>;
}

export interface PendingRequestBlockActions {
  resolveApproval: (requestId: PendingRequestId, action: ApprovalAction) => void;
  resolveUserInput: (requestId: PendingRequestId) => void;
  cancelUserInput: (requestId: PendingRequestId) => void;
  resolveMcpElicitation: (requestId: PendingRequestId, action: McpElicitationAction) => void;
  setApprovalDetailsExpanded?: (requestId: PendingRequestId, expanded: boolean) => void;
  setUserInputDraft: (key: string, value: string) => void;
  setMcpElicitationDraft: (key: string, value: string) => void;
}

export interface TextItemDetailStateContext {
  disclosures: ThreadStreamDisclosureState;
  onDisclosureToggle?: (bucket: ThreadStreamDisclosureBucket, id: string, open: boolean) => void;
}

export interface TextItemContentContext extends TextItemDetailStateContext {
  renderObsidianMarkdown: (parent: HTMLElement, text: string) => void;
  renderStreamMarkdown: (parent: HTMLElement, text: string) => void;
}

export interface TextItemActionContext extends TextItemDetailStateContext {
  forkMenuItemId: string | null;
  onForkMenuToggle?: (itemId: string | null) => void;
  copyText?: (text: string) => void;
  onImplementPlan?: (target: PlanImplementationTarget) => void;
  onRollback?: () => void;
  onFork?: (target: ThreadStreamForkTarget, archiveSource: boolean) => void;
}

export interface TextItemMetadataContext extends TextItemDetailStateContext {
  activeThreadId: string | null;
  workspaceRoot?: string | null;
  openTurnDiff?: (state: TurnDiffViewState) => void;
}

interface ThreadStreamRenderContext {
  activeThreadId: string | null;
  workspaceRoot?: string | null;
  loadOlderTurns: () => void;
  openThreadInNewView?: (threadId: string) => void;
  pendingRequests?: PendingRequestBlockContext;
}

export interface TextItemContext extends TextItemContentContext, TextItemActionContext, TextItemMetadataContext {}

export interface ThreadStreamContext extends ThreadStreamRenderContext, TextItemContext {}

export interface PendingRequestBlockContext {
  signature: string;
  snapshot: () => PendingRequestBlockSnapshot;
  actions: () => PendingRequestBlockActions;
  consumeAutoFocus: () => boolean;
}
