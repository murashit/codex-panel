import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { ModeKind } from "../../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { ApprovalsReviewer } from "../../generated/app-server/v2/ApprovalsReviewer";
import type { ConfigReadResponse } from "../../generated/app-server/v2/ConfigReadResponse";
import type { Model } from "../../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../../generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../../generated/app-server/v2/SkillMetadata";
import type { Thread } from "../../generated/app-server/v2/Thread";
import type { ThreadTokenUsage } from "../../generated/app-server/v2/ThreadTokenUsage";
import type { AppServerDiagnostics } from "../../app-server/compatibility";
import { createAppServerDiagnostics } from "../../app-server/compatibility";
import type { PendingApproval } from "./approvals/model";
import type { ComposerSuggestion } from "./composer/suggestions";
import type { DisplayItem } from "./display/types";
import type { PendingUserInput } from "./user-input/model";
import type { ReportedServiceTier, ServiceTier } from "../../app-server/service-tier";
import { defaultRuntimeOverride, type RuntimeOverride } from "../../runtime/state";

export interface PendingTurnStart {
  anchorItemId: string;
  promptSubmitHookItemIds: string[];
}

export interface ChatState {
  status: string;
  effectiveConfig: ConfigReadResponse | null;
  initializeResponse: InitializeResponse | null;
  activeThreadId: string | null;
  activeThreadCwd: string | null;
  activeTurnId: string | null;
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: ModeKind;
  activeServiceTier: ReportedServiceTier | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  activeThreadCliVersion: string | null;
  appServerDiagnostics: AppServerDiagnostics;
  requestedModel: RuntimeOverride<string>;
  requestedReasoningEffort: RuntimeOverride<ReasoningEffort>;
  requestedApprovalsReviewer: ApprovalsReviewer | null;
  requestedCollaborationMode: ModeKind;
  requestedServiceTier: ServiceTier | null;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  busy: boolean;
  displayItems: DisplayItem[];
  pendingTurnStart: PendingTurnStart | null;
  turnDiffs: Map<string, string>;
  approvals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  userInputDrafts: Map<string, string>;
  listedThreads: Thread[];
  threadsLoaded: boolean;
  historyCursor: string | null;
  loadingHistory: boolean;
  composerDraft: string;
  runtimePicker: "model" | "effort" | null;
  availableModels: Model[];
  availableSkills: SkillMetadata[];
  reportedLogs: Set<string>;
  composerSuggestSelected: number;
  composerSuggestions: ComposerSuggestion[];
  composerSuggestionsDismissedSignature: string | null;
  messagesPinnedToBottom: boolean;
  openDetails: Set<string>;
}

export function createChatState(): ChatState {
  return {
    status: "Idle",
    effectiveConfig: null,
    initializeResponse: null,
    activeThreadId: null,
    activeThreadCwd: null,
    activeTurnId: null,
    activeModel: null,
    activeReasoningEffort: null,
    activeCollaborationMode: "default",
    activeServiceTier: null,
    activeApprovalsReviewer: null,
    activeThreadCliVersion: null,
    appServerDiagnostics: createAppServerDiagnostics(),
    requestedModel: defaultRuntimeOverride(),
    requestedReasoningEffort: defaultRuntimeOverride(),
    requestedApprovalsReviewer: null,
    requestedCollaborationMode: "default",
    requestedServiceTier: null,
    tokenUsage: null,
    rateLimit: null,
    busy: false,
    displayItems: [],
    pendingTurnStart: null,
    turnDiffs: new Map(),
    approvals: [],
    pendingUserInputs: [],
    userInputDrafts: new Map(),
    listedThreads: [],
    threadsLoaded: false,
    historyCursor: null,
    loadingHistory: false,
    composerDraft: "",
    runtimePicker: null,
    availableModels: [],
    availableSkills: [],
    reportedLogs: new Set(),
    composerSuggestSelected: 0,
    composerSuggestions: [],
    composerSuggestionsDismissedSignature: null,
    messagesPinnedToBottom: true,
    openDetails: new Set(),
  };
}

export function clearActiveTurnState(state: ChatState): void {
  state.activeTurnId = null;
  state.busy = false;
  state.pendingTurnStart = null;
  state.approvals = [];
  state.pendingUserInputs = [];
  state.userInputDrafts.clear();
}

export function clearActiveThreadState(state: ChatState): void {
  state.activeThreadId = null;
  state.activeThreadCwd = null;
  state.activeModel = null;
  state.activeReasoningEffort = null;
  state.activeCollaborationMode = "default";
  state.activeServiceTier = null;
  state.activeApprovalsReviewer = null;
  state.activeThreadCliVersion = null;
  state.tokenUsage = null;
  state.historyCursor = null;
  state.loadingHistory = false;
  state.displayItems = [];
  state.turnDiffs.clear();
  state.messagesPinnedToBottom = true;
  clearActiveTurnState(state);
}

export function clearConnectionScopedState(state: ChatState): void {
  clearActiveTurnState(state);
  state.activeModel = null;
  state.activeReasoningEffort = null;
  state.activeCollaborationMode = "default";
  state.activeServiceTier = null;
  state.activeApprovalsReviewer = null;
  state.activeThreadCliVersion = null;
  state.rateLimit = null;
  state.listedThreads = [];
  state.threadsLoaded = false;
  state.availableModels = [];
  state.availableSkills = [];
  state.appServerDiagnostics = createAppServerDiagnostics();
  state.runtimePicker = null;
}
