export type EffectOutcome<T> =
  | { readonly kind: "not-started" }
  | { readonly kind: "completed-current"; readonly value: T }
  | { readonly kind: "completed-stale"; readonly value: T };

export function effectCompleted<T>(outcome: EffectOutcome<T>): outcome is Exclude<EffectOutcome<T>, { kind: "not-started" }> {
  return outcome.kind !== "not-started";
}

export function effectCompletedInCurrentContext<T>(
  outcome: EffectOutcome<T>,
): outcome is Extract<EffectOutcome<T>, { kind: "completed-current" }> {
  return outcome.kind === "completed-current";
}
