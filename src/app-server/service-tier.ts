export type ServiceTier = "fast" | "standard";
export type ServiceTierRequest = "fast" | null | undefined;

export function parseServiceTier(value: unknown): ServiceTier | null {
  if (value === "fast" || value === "priority") return "fast";
  if (value === "standard" || value === "default" || value === "flex") return "standard";
  return null;
}

export function serviceTierRequestValue(value: ServiceTier | null): ServiceTierRequest {
  if (value === "fast") return "fast";
  if (value === "standard") return null;
  return undefined;
}
