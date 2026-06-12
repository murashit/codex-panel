import type { ReasoningEffort } from "../catalog/metadata";
import type { ApprovalPolicy, ApprovalsReviewer } from "./policy";
import type { ReasoningSummary } from "./config";

export type RuntimeServiceTierRequest = string | null | undefined;
export type ModeKind = "plan" | "default";
type Personality = "none" | "friendly" | "pragmatic";
type NetworkAccess = "restricted" | "enabled";

type SandboxPolicy =
  | { type: "dangerFullAccess" }
  | { type: "readOnly"; networkAccess: boolean }
  | { type: "externalSandbox"; networkAccess: NetworkAccess }
  | {
      type: "workspaceWrite";
      writableRoots: string[];
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    };

export interface CollaborationMode {
  mode: ModeKind;
  settings: {
    model: string;
    reasoningEffort: ReasoningEffort | null;
    developerInstructions: string | null;
  };
}

export interface RuntimeSettingsPatch {
  cwd?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandboxPolicy?: SandboxPolicy | null;
  permissions?: string | null;
  model?: string | null;
  serviceTier?: string | null;
  effort?: ReasoningEffort | null;
  summary?: ReasoningSummary | null;
  collaborationMode?: CollaborationMode | null;
  personality?: Personality | null;
}

export function applyRuntimeSettingsPatchValue<K extends keyof RuntimeSettingsPatch>(
  update: RuntimeSettingsPatch,
  key: K,
  value: RuntimeSettingsPatch[K] | undefined,
): void {
  if (value !== undefined) update[key] = value;
}

export function runtimeCollaborationModeSettings(
  mode: ModeKind,
  model: string,
  reasoningEffort: ReasoningEffort | null,
): CollaborationMode {
  return {
    mode,
    settings: {
      model,
      reasoningEffort,
      developerInstructions: null,
    },
  };
}
