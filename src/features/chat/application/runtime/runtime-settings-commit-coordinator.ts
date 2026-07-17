import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import { createKeyedOperationQueue, type KeyedOperationQueue } from "../../../../shared/runtime/keyed-operation-queue";

export type RuntimeSettingsCommitTarget = { readonly kind: "settle" } | { readonly kind: "fields"; readonly update: RuntimeSettingsPatch };

interface RuntimeSettingsCommitScope {
  readonly threadId: string;
  readonly panelTargetRevision: number;
}

export interface RuntimeSettingsCommitCoordinatorHost {
  scopeIsCurrent: (scope: RuntimeSettingsCommitScope) => boolean;
  pendingPatch: () => RuntimeSettingsPatch;
  updateThreadSettings: (threadId: string, update: RuntimeSettingsPatch) => Promise<boolean>;
  commitPatch: (update: RuntimeSettingsPatch) => void;
  reportError: (error: unknown) => void;
}

export interface RuntimeSettingsCommitCoordinator {
  commit: (scope: RuntimeSettingsCommitScope, target: RuntimeSettingsCommitTarget) => Promise<boolean>;
}

interface PendingCommit {
  readonly kind: RuntimeSettingsCommitTarget["kind"];
  remaining: RuntimeSettingsPatch;
  resolve: (ok: boolean) => void;
}

interface ThreadCommitDrain {
  revision: number;
  readonly pending: PendingCommit[];
}

export function createRuntimeSettingsCommitCoordinator(
  host: RuntimeSettingsCommitCoordinatorHost,
  threadCommits: KeyedOperationQueue<string> = createKeyedOperationQueue(),
): RuntimeSettingsCommitCoordinator {
  const drainsByThread = new Map<string, Map<number, ThreadCommitDrain>>();

  return {
    commit: (scope, target) => {
      let threadDrains = drainsByThread.get(scope.threadId);
      if (!threadDrains) {
        threadDrains = new Map();
        drainsByThread.set(scope.threadId, threadDrains);
      }
      let drain = threadDrains.get(scope.panelTargetRevision);
      if (!drain) {
        drain = { revision: 0, pending: [] };
        threadDrains.set(scope.panelTargetRevision, drain);
      }
      drain.revision += 1;
      const result = new Promise<boolean>((resolve) => {
        drain.pending.push({
          kind: target.kind,
          remaining: target.kind === "fields" ? { ...target.update } : {},
          resolve,
        });
      });
      if (drain.pending.length === 1) {
        const scheduledDrain = drain;
        void threadCommits
          .run(scope.threadId, () => runThreadCommitDrain(host, scope, scheduledDrain))
          .finally(() => {
            if (threadDrains.get(scope.panelTargetRevision) === scheduledDrain) {
              threadDrains.delete(scope.panelTargetRevision);
              if (threadDrains.size === 0) drainsByThread.delete(scope.threadId);
            }
          });
      }
      return result;
    },
  };
}

async function runThreadCommitDrain(
  host: RuntimeSettingsCommitCoordinatorHost,
  scope: RuntimeSettingsCommitScope,
  drain: ThreadCommitDrain,
): Promise<void> {
  while (drain.pending.length > 0) {
    if (!host.scopeIsCurrent(scope)) {
      resolveAll(drain, false);
      return;
    }

    const update = host.pendingPatch();
    if (patchEmpty(update)) {
      resolveSettledCommits(drain);
      return;
    }

    const sentRevision = drain.revision;
    let updated: boolean;
    try {
      updated = await host.updateThreadSettings(scope.threadId, update);
    } catch (error) {
      if (host.scopeIsCurrent(scope)) host.reportError(error);
      resolveAll(drain, false);
      return;
    }

    if (!host.scopeIsCurrent(scope)) {
      resolveAll(drain, false);
      return;
    }
    if (!updated) {
      resolveAll(drain, false);
      return;
    }

    const committed = matchingPendingPatch(host.pendingPatch(), update);
    if (!patchEmpty(committed)) host.commitPatch(committed);
    resolveFieldCommits(drain, committed, host.pendingPatch());

    if (drain.pending.length === 0) return;
    if (patchEmpty(host.pendingPatch())) {
      resolveSettledCommits(drain);
      return;
    }
    if (drain.revision !== sentRevision || drain.pending.some((pending) => pending.kind === "settle")) {
      continue;
    }

    resolveAll(drain, false);
    return;
  }
}

function matchingPendingPatch(current: RuntimeSettingsPatch, sent: RuntimeSettingsPatch): RuntimeSettingsPatch {
  const matching: RuntimeSettingsPatch = {};
  for (const key of patchKeys(sent)) {
    if (key in current && threadSettingsValueEqual(current[key], sent[key])) {
      Object.assign(matching, { [key]: sent[key] });
    }
  }
  return matching;
}

function resolveFieldCommits(drain: ThreadCommitDrain, committed: RuntimeSettingsPatch, current: RuntimeSettingsPatch): void {
  for (const pending of [...drain.pending]) {
    if (pending.kind === "settle") continue;
    for (const key of patchKeys(pending.remaining)) {
      if (key in committed && threadSettingsValueEqual(pending.remaining[key], committed[key])) {
        pending.remaining = patchWithoutField(pending.remaining, key);
      }
    }
    if (patchEmpty(pending.remaining)) {
      resolveCommit(drain, pending, true);
      continue;
    }
    if (patchKeys(pending.remaining).some((key) => !(key in current) || !threadSettingsValueEqual(pending.remaining[key], current[key]))) {
      resolveCommit(drain, pending, false);
    }
  }
}

function resolveSettledCommits(drain: ThreadCommitDrain): void {
  for (const pending of [...drain.pending]) {
    resolveCommit(drain, pending, pending.kind === "settle" || patchEmpty(pending.remaining));
  }
}

function resolveAll(drain: ThreadCommitDrain, ok: boolean): void {
  for (const pending of [...drain.pending]) resolveCommit(drain, pending, ok);
}

function resolveCommit(drain: ThreadCommitDrain, pending: PendingCommit, ok: boolean): void {
  const index = drain.pending.indexOf(pending);
  if (index >= 0) drain.pending.splice(index, 1);
  pending.resolve(ok);
}

function patchKeys(patch: RuntimeSettingsPatch): (keyof RuntimeSettingsPatch)[] {
  return Object.keys(patch) as (keyof RuntimeSettingsPatch)[];
}

function patchEmpty(patch: RuntimeSettingsPatch): boolean {
  return patchKeys(patch).length === 0;
}

function patchWithoutField(patch: RuntimeSettingsPatch, omittedKey: keyof RuntimeSettingsPatch): RuntimeSettingsPatch {
  const remaining: RuntimeSettingsPatch = {};
  for (const key of patchKeys(patch)) {
    if (key !== omittedKey) Object.assign(remaining, { [key]: patch[key] });
  }
  return remaining;
}

function threadSettingsValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => threadSettingsValueEqual(value, right[index]))
    );
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && threadSettingsValueEqual(left[key], right[key]))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
