import type { Thread } from "../../../../domain/threads/model";
import type { CodexInput } from "../../../../domain/turns/input";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { PreparedInput } from "../composer/prepared-input";
import type { ComposerSubmissionAdoption } from "../composer/submission-claim";
import type { ReconnectPanelOptions } from "../connection/reconnect-command";
import type { ChatRuntimeSettingsCommands } from "../runtime/settings-commands";
import type { GoalCommands } from "../threads/goal-commands";
import type { ThreadCommands } from "../threads/thread-commands";
import type { ThreadCommandTarget } from "./thread-arguments";

export interface SlashCommandExecutionPorts {
  startNewThread: () => Promise<void>;
  startThreadForGoal: (objective: string, adoptPanelTarget?: ComposerSubmissionAdoption["adoptPanelTarget"]) => Promise<string | null>;
  resumeThread: (threadId: string) => Promise<void>;
  threadCommands: {
    forkThread: ThreadCommands["forkThread"];
    rollbackThread: ThreadCommands["rollbackThread"];
    compactThread: ThreadCommands["compactThread"];
    archiveThread: ThreadCommands["archiveThread"];
    renameThread: ThreadCommands["renameThread"];
  };
  reconnect: (options?: ReconnectPanelOptions) => Promise<void>;
  openSideChat?: (threadId: string, message?: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: ThreadStreamNoticeSection[]) => void;
  runtimeSettings: {
    toggleFastMode: ChatRuntimeSettingsCommands["toggleFastMode"];
    toggleCollaborationMode: ChatRuntimeSettingsCommands["toggleCollaborationMode"];
    toggleAutoReview: ChatRuntimeSettingsCommands["toggleAutoReview"];
    requestModel: ChatRuntimeSettingsCommands["requestModel"];
    resetModelToConfig: ChatRuntimeSettingsCommands["resetModelToConfig"];
    requestPermissionProfile: ChatRuntimeSettingsCommands["requestPermissionProfile"];
    resetPermissionProfileToConfig: ChatRuntimeSettingsCommands["resetPermissionProfileToConfig"];
    requestReasoningEffort: ChatRuntimeSettingsCommands["requestReasoningEffort"];
    resetReasoningEffortToConfig: ChatRuntimeSettingsCommands["resetReasoningEffortToConfig"];
  };
  goals: {
    activeGoal: GoalCommands["activeGoal"];
    setObjective: GoalCommands["setObjective"];
    setStatus: GoalCommands["setStatus"];
    clear: GoalCommands["clear"];
  };
  statusDetails: () => ThreadStreamNoticeSection[];
  permissionDetails: () => ThreadStreamNoticeSection[];
  connectionDiagnosticDetails: () => ThreadStreamNoticeSection[];
  toolInventoryDetails: () => ThreadStreamNoticeSection[] | Promise<ThreadStreamNoticeSection[]>;
  modelStatusDetails: () => ThreadStreamNoticeSection[];
  effortStatusDetails: () => ThreadStreamNoticeSection[];
}

export interface SlashCommandExecutionContext extends SlashCommandExecutionPorts {
  activeThreadId: string | null;
  listedThreads: readonly Thread[];
  threadCommandTarget?: ThreadCommandTarget;
  referThread: (thread: Thread, message: string, inputSnapshot: ComposerInputSnapshot) => Promise<PreparedInput>;
  readWebUrl: (url: string, message: string, inputSnapshot: ComposerInputSnapshot, isCurrent?: () => boolean) => Promise<PreparedInput>;
  inputSnapshot?: ComposerInputSnapshot;
  submission: ComposerSubmissionAdoption;
}

export interface SlashCommandExecutionResult {
  sendText?: string;
  sendInput?: CodexInput;
  composerDraft?: string;
}
