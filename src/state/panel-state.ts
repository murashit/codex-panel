import type { InitializeResponse } from "../generated/app-server/InitializeResponse";
import type { ModeKind } from "../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { Model } from "../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../generated/app-server/v2/SkillMetadata";
import type { Thread } from "../generated/app-server/v2/Thread";
import type { ThreadTokenUsage } from "../generated/app-server/v2/ThreadTokenUsage";
import type { AppServerCompatibility } from "../app-server/compatibility";
import { createAppServerCompatibility } from "../app-server/compatibility";
import type { PendingApproval } from "../approvals/model";
import type { ComposerSuggestion } from "../composer/suggestions";
import type { DisplayItem } from "../display/types";
import type { PendingUserInput } from "../user-input/model";
import type { ServiceTier } from "../app-server/service-tier";
import { defaultRuntimeOverride, type RuntimeOverride } from "../panel/runtime-state";

export interface PanelState {
  status: string;
  effectiveConfig: ConfigReadResponse | null;
  initializeResponse: InitializeResponse | null;
  activeThreadId: string | null;
  activeThreadCwd: string | null;
  activeTurnId: string | null;
  activeModel: string | null;
  activeServiceTier: string | null;
  activeThreadCliVersion: string | null;
  appServerCompatibility: AppServerCompatibility;
  requestedModel: RuntimeOverride<string>;
  requestedReasoningEffort: RuntimeOverride<ReasoningEffort>;
  requestedCollaborationMode: ModeKind;
  requestedServiceTier: ServiceTier | null;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  busy: boolean;
  displayItems: DisplayItem[];
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
  reportedMcpFailures: Set<string>;
  reportedLogs: Set<string>;
  composerSuggestSelected: number;
  composerSuggestions: ComposerSuggestion[];
  composerSuggestionsDismissedSignature: string | null;
  messagesPinnedToBottom: boolean;
  openDetails: Set<string>;
}

export function createPanelState(): PanelState {
  return {
    status: "Idle",
    effectiveConfig: null,
    initializeResponse: null,
    activeThreadId: null,
    activeThreadCwd: null,
    activeTurnId: null,
    activeModel: null,
    activeServiceTier: null,
    activeThreadCliVersion: null,
    appServerCompatibility: createAppServerCompatibility(),
    requestedModel: defaultRuntimeOverride(),
    requestedReasoningEffort: defaultRuntimeOverride(),
    requestedCollaborationMode: "default",
    requestedServiceTier: null,
    tokenUsage: null,
    rateLimit: null,
    busy: false,
    displayItems: [],
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
    reportedMcpFailures: new Set(),
    reportedLogs: new Set(),
    composerSuggestSelected: 0,
    composerSuggestions: [],
    composerSuggestionsDismissedSignature: null,
    messagesPinnedToBottom: true,
    openDetails: new Set(),
  };
}

export function clearActiveTurnState(state: PanelState): void {
  state.activeTurnId = null;
  state.busy = false;
  state.approvals = [];
  state.pendingUserInputs = [];
  state.userInputDrafts.clear();
}

export function clearActiveThreadState(state: PanelState): void {
  state.activeThreadId = null;
  state.activeThreadCwd = null;
  state.activeModel = null;
  state.activeServiceTier = null;
  state.activeThreadCliVersion = null;
  state.tokenUsage = null;
  state.historyCursor = null;
  state.loadingHistory = false;
  state.displayItems = [];
  state.messagesPinnedToBottom = true;
  clearActiveTurnState(state);
}

export function clearConnectionScopedState(state: PanelState): void {
  clearActiveTurnState(state);
  state.activeModel = null;
  state.activeServiceTier = null;
  state.activeThreadCliVersion = null;
  state.rateLimit = null;
  state.listedThreads = [];
  state.threadsLoaded = false;
  state.availableModels = [];
  state.runtimePicker = null;
}
