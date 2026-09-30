import type { Thread, ThreadActivationSnapshot } from "../../src/domain/threads/model";

export function threadActivationFixture(thread: Thread, overrides: Partial<ThreadActivationSnapshot> = {}): ThreadActivationSnapshot {
  return {
    thread,
    canAcceptDirectInput: null,
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    ...overrides,
  };
}
