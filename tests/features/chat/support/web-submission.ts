import type { ChatPendingSubmissionState } from "../../../../src/features/chat/application/state/pending-submission";

export function pendingWebSubmissionFixture(
  targetThreadId: string | null,
  overrides: Partial<ChatPendingSubmissionState> = {},
): ChatPendingSubmissionState {
  return {
    id: "local-web",
    item: {
      id: "local-web",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "https://example.com/ summarize",
      copyText: "https://example.com/ summarize",
      executionState: "running",
      contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      provenance: { source: "localUser", channel: "preflight", interaction: "prompt", sourceId: "local-web" },
    },
    targetThreadId,
    phase: "cancellable",
    ...overrides,
  };
}
