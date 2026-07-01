import type { PendingRuntimeIntent } from "./intent";

export type RuntimeValueSource = "pending" | "active-thread" | "config" | "none";

export interface RuntimeLayeredValue<T, Pending = T> {
  readonly configured: T | null;
  readonly active: T | null;
  readonly pending: PendingRuntimeIntent<Pending>;
  readonly confirmed: T | null;
  readonly confirmedSource: RuntimeValueSource;
  readonly effective: T | null;
  readonly source: RuntimeValueSource;
}

export function resolveRuntimeValue<T>(input: {
  configured: T | null | undefined;
  active: T | null | undefined;
  pending?: PendingRuntimeIntent<T>;
  activeKnown?: boolean;
}): RuntimeLayeredValue<T> {
  return resolveRuntimeLayeredValue({
    ...input,
    pending: input.pending ?? ({ kind: "unchanged" } satisfies PendingRuntimeIntent<T>),
    pendingEffectiveValue: (value) => value,
  });
}

export function resolveRuntimeNullablePendingValue<T>(input: {
  configured: T | null | undefined;
  active: T | null | undefined;
  pending: PendingRuntimeIntent<T | null>;
  activeKnown?: boolean;
}): RuntimeLayeredValue<T, T | null> {
  return resolveRuntimeLayeredValue({
    ...input,
    pendingEffectiveValue: (value) => value,
  });
}

export function runtimeLayeredValue<T, Pending = T>(input: {
  configured: T | null | undefined;
  active: T | null | undefined;
  pending: PendingRuntimeIntent<Pending>;
  activeKnown: boolean;
  effective: T | null;
  source: RuntimeValueSource;
}): RuntimeLayeredValue<T, Pending> {
  const configured = input.configured ?? null;
  const active = input.active ?? null;
  const { confirmed, confirmedSource } = confirmedRuntimeValue(configured, active, input.activeKnown);
  return {
    configured,
    active,
    pending: input.pending,
    confirmed,
    confirmedSource,
    effective: input.effective,
    source: input.source,
  };
}

function resolveRuntimeLayeredValue<T, Pending>(input: {
  configured: T | null | undefined;
  active: T | null | undefined;
  pending: PendingRuntimeIntent<Pending>;
  activeKnown?: boolean;
  pendingEffectiveValue: (value: Pending) => T | null;
}): RuntimeLayeredValue<T, Pending> {
  const configured = input.configured ?? null;
  const active = input.active ?? null;
  const activeKnown = input.activeKnown ?? active !== null;
  const { confirmed, confirmedSource } = confirmedRuntimeValue(configured, active, activeKnown);
  if (input.pending.kind === "set") {
    return {
      configured,
      active,
      pending: input.pending,
      confirmed,
      confirmedSource,
      effective: input.pendingEffectiveValue(input.pending.value),
      source: "pending",
    };
  }
  if (input.pending.kind === "resetToConfig") {
    return { configured, active, pending: input.pending, confirmed, confirmedSource, effective: configured, source: "config" };
  }
  return { configured, active, pending: input.pending, confirmed, confirmedSource, effective: confirmed, source: confirmedSource };
}

function confirmedRuntimeValue<T>(
  configured: T | null,
  active: T | null,
  activeKnown: boolean,
): Pick<RuntimeLayeredValue<T>, "confirmed" | "confirmedSource"> {
  if (activeKnown) return { confirmed: active, confirmedSource: "active-thread" };
  if (configured !== null) return { confirmed: configured, confirmedSource: "config" };
  return { confirmed: null, confirmedSource: "none" };
}
