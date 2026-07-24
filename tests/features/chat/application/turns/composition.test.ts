import { describe, expect, it, vi } from "vitest";

import type { CodexInput } from "../../../../../src/domain/chat/input";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { ComposerInputSnapshot } from "../../../../../src/features/chat/application/composer/input-snapshot";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createTurnWorkflowCommands } from "../../../../../src/features/chat/application/turns/composition";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

const planItem = (id: string): ThreadStreamItem => ({
  id,
  kind: "dialogue",
  role: "assistant",
  text: "Plan",
  dialogueKind: "proposedPlan",
  dialogueState: "completed",
});

function thread(id: string): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
  };
}

function resumeThread(stateStore: ReturnType<typeof createChatStateStore>, items: readonly ThreadStreamItem[]): void {
  stateStore.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: thread("thread"),
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
    items,
  });
  stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "plan" });
}

describe("createTurnWorkflowCommands", () => {
  it("does not attach composer-only active file context when implementing a plan", async () => {
    const stateStore = createChatStateStore(createChatState());
    const plan = planItem("plan");
    resumeThread(stateStore, [plan]);
    const startTurn = vi.fn().mockResolvedValue({ kind: "completed-current" as const, value: { turnId: "turn" } });
    const composerSnapshot: ComposerInputSnapshot = {
      sourcePath: "notes/Alpha.md",
      availableSkills: [],
      referenceActiveNoteOnSend: true,
      contextReferences: {
        activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" },
        selection: null,
      },
      activeNoteSnapshots: [],
      selectionSnapshots: [],
      attachments: [],
    };
    const prepareInput = vi.fn((text: string, _snapshot: ComposerInputSnapshot): { text: string; input: CodexInput } => ({
      text,
      input: [
        { type: "text", text },
        { type: "fileReference", name: "unexpected", path: "notes/Alpha.md" },
      ],
    }));
    const setDraft = vi.fn();
    const actions = createTurnWorkflowCommands(
      {
        stateStore,
        localItemIds: createLocalIdSource(),
        connectionAvailable: () => true,
        turnPort: {
          ensureConnected: vi.fn().mockResolvedValue(true),
          startTurn,
          steerTurn: vi.fn().mockResolvedValue({ kind: "completed-current" as const, value: undefined }),
          interruptTurn: vi.fn().mockResolvedValue(true),
        },
        referThread: vi.fn(),
        readWebUrl: vi.fn(),
        status: {
          set: vi.fn(),
          addSystemMessage: vi.fn(),
          addStructuredSystemMessage: vi.fn(),
        },
        runtime: {
          connectionDiagnosticDetails: () => [],
          permissionDetails: () => [],
          modelStatusDetails: () => [],
          effortStatusDetails: () => [],
          statusDetails: () => [],
          toolInventoryDetails: () => [],
        },
        thread: {
          ensureRestoredThreadLoaded: vi.fn().mockResolvedValue(true),
          startNewThread: vi.fn(),
          selectThread: vi.fn(),
          notifyIdentityChanged: vi.fn(),
          resetTurnPresence: vi.fn(),
        },
        composer: {
          prepareInput,
          captureInputSnapshot: vi.fn(() => composerSnapshot),
          claimSubmission: vi.fn(() => null),
          isSubmissionPreparing: vi.fn(() => false),
          failActiveSubmissionClaim: vi.fn(),
          draft: () => "",
          trimmedDraft: () => "",
          setDraft,
        },
        scroll: { showLatest: vi.fn() },
      },
      {
        threadStartCommand: { startThread: vi.fn() },
        runtimeSettings: {
          applyPendingThreadSettings: vi.fn().mockResolvedValue(true),
          requestDefaultCollaborationModeForNextTurn: vi.fn(() => {
            stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
          }),
        } as never,
        threadCommands: {} as never,
        reconnectCommand: vi.fn(),
        goals: {} as never,
      },
    );
    await actions.planImplementation.implement(plan.id);

    expect(prepareInput).not.toHaveBeenCalled();
    expect(setDraft).not.toHaveBeenCalled();
    expect(startTurn).toHaveBeenCalledWith({
      threadId: "thread",
      input: [{ type: "text", text: IMPLEMENT_PLAN_PROMPT }],
      clientUserMessageId: expect.any(String),
    });
  });
});
