export type EffectOutcome<T> = { readonly kind: "not-started" } | { readonly kind: "completed"; readonly value: T };
