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

export function resolveRuntimeValue<T, Pending extends T | null = T>(input: {
  configured: T | null | undefined;
  active: T | null | undefined;
  pending: PendingRuntimeIntent<Pending>;
  activeKnown?: boolean;
}): RuntimeLayeredValue<T, Pending> {
  const configured = input.configured ?? null;
  const active = input.active ?? null;
  const activeKnown = input.activeKnown ?? active !== null;
  const { confirmed, confirmedSource } = confirmedRuntimeValue(configured, active, activeKnown);
  const base = { configured, active, pending: input.pending, confirmed, confirmedSource };
  switch (input.pending.kind) {
    case "set":
      return { ...base, effective: input.pending.value, source: "pending" };
    case "resetToConfig":
      return { ...base, effective: configured, source: "config" };
    case "unchanged":
      return { ...base, effective: confirmed, source: confirmedSource };
  }
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
