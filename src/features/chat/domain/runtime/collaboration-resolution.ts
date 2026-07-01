import { effectiveCollaborationMode } from "./intent";
import type { RuntimeSnapshot } from "./snapshot";

export interface CollaborationModeResolution {
  readonly active: RuntimeSnapshot["active"]["collaborationMode"];
  readonly pending: RuntimeSnapshot["pending"]["collaborationMode"];
  readonly confirmed: NonNullable<RuntimeSnapshot["active"]["collaborationMode"]>;
  readonly effective: NonNullable<RuntimeSnapshot["active"]["collaborationMode"]>;
  readonly dirty: boolean;
  readonly blockedReason: "missing-model" | null;
}

export function resolveCollaborationMode(snapshot: RuntimeSnapshot, model: string | null): CollaborationModeResolution {
  const active = snapshot.active.collaborationMode;
  const pending = snapshot.pending.collaborationMode;
  const confirmed = effectiveCollaborationMode(active);
  const effective = pending.kind === "set" ? pending.value : confirmed;
  const dirty = pending.kind === "set";
  return {
    active,
    pending,
    confirmed,
    effective,
    dirty,
    blockedReason: dirty && !model ? "missing-model" : null,
  };
}
