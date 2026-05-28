export type ServiceTier = "fast" | "standard";
export type ServiceTierRequest = "fast" | null | undefined;

export function parseServiceTier(value: unknown): ServiceTier | null {
  if (value === "fast") return "fast";
  if (value === "standard") return "standard";
  return null;
}

export function reportedServiceTier(value: string | null | undefined): ServiceTier | null {
  return parseServiceTier(value);
}

export function serviceTierRequestValue(value: ServiceTier | null): ServiceTierRequest {
  if (value === "fast") return "fast";
  if (value === "standard") return null;
  return undefined;
}
