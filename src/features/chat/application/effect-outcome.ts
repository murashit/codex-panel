export type EffectOutcome<T> = { readonly kind: "not-started" } | { readonly kind: "completed"; readonly value: T };

export function effectCompleted<T>(outcome: EffectOutcome<T>): outcome is Exclude<EffectOutcome<T>, { kind: "not-started" }> {
  return outcome.kind === "completed";
}
