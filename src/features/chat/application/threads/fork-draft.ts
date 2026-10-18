import type { ReasoningEffort } from "../../../../domain/runtime/catalog";
import type { RuntimeApprovalPolicy, RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/settings";
import { type ActiveThreadRuntimeState, type ChatRuntimeState, initialChatRuntimeState } from "../../domain/runtime/state";
import type { ForkDisplaySnapshot } from "./fork-display-snapshot";

export type ForkDraft = {
  readonly sourceThreadId: string;
  readonly initialPrompt?: string;
} & (
  | { readonly kind: "persistent"; readonly boundary: ThreadForkPosition; readonly replacement?: ForkReplacement }
  | { readonly kind: "side-chat"; readonly sourceThreadTitle: string | null }
);

export function sideChatDraft(
  sourceThreadId: string,
  sourceThreadTitle: string | null,
  runtime: ChatRuntimeState = initialChatRuntimeState(),
): ForkDraftPreparation {
  return {
    draft: { kind: "side-chat", sourceThreadId, sourceThreadTitle },
    runtime: forkDraftRuntime({ ...runtime, pending: initialChatRuntimeState().pending }),
    display: { items: [], turnDiffs: new Map() },
  };
}

export interface ForkReplacement {
  readonly sourceThreadId: string;
  readonly sourceLatestTurnId: string;
  readonly saveMarkdown: boolean;
}

export interface ForkDraftPreparation {
  readonly runtime: ChatRuntimeState;
  readonly draft: ForkDraft;
  readonly display: ForkDisplaySnapshot;
}

type ThreadForkPosition =
  | { readonly kind: "through-turn"; readonly turnId: string }
  | { readonly kind: "before-turn"; readonly turnId: string };

export interface ThreadForkOptions {
  readonly position?: ThreadForkPosition;
  readonly deferGoalContinuation?: boolean;
  readonly runtime?: ThreadForkRuntimeOverrides;
}

export interface ThreadForkRuntimeOverrides {
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort | null;
  readonly serviceTier?: ServiceTier | null;
  readonly approvalPolicy?: RuntimeApprovalPolicy;
  readonly approvalsReviewer?: ApprovalsReviewer;
  readonly permissions?: string;
  readonly sandboxPolicy?: RuntimeSandboxPolicy;
}

export function forkDraftRuntime({ active, pending }: ChatRuntimeState): ChatRuntimeState {
  // The fork request carries inherited settings except collaboration mode.
  // Reserve that mode for the first turn; leave explicit user changes intact.
  return {
    active,
    pending: {
      ...pending,
      collaborationMode:
        pending.collaborationMode.kind === "unchanged" && active.collaborationMode
          ? { kind: "set", value: active.collaborationMode }
          : pending.collaborationMode,
    },
  };
}

export function forkRuntimeSettings(active: ActiveThreadRuntimeState): ThreadForkRuntimeOverrides {
  return {
    ...(active.model ? { model: active.model } : {}),
    reasoningEffort: active.reasoningEffort,
    ...(active.serviceTierKnown ? { serviceTier: active.serviceTier } : {}),
    ...(active.approvalPolicyKnown && active.approvalPolicy ? { approvalPolicy: active.approvalPolicy } : {}),
    ...(active.approvalsReviewer ? { approvalsReviewer: active.approvalsReviewer } : {}),
    ...(active.permissionProfileKnown && active.activePermissionProfile
      ? { permissions: active.activePermissionProfile.id }
      : active.sandboxPolicyKnown && active.sandboxPolicy
        ? { sandboxPolicy: active.sandboxPolicy }
        : {}),
  };
}
