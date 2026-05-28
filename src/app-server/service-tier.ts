export type ServiceTier = string;
export type RequestedServiceTier = "fast" | "off";
export type ServiceTierRequest = string | null | undefined;

export function parseServiceTier(value: unknown): ServiceTier | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

export function requestedServiceTierRequestValue(value: RequestedServiceTier | null): "fast" | null | undefined {
  if (value === "fast") return "fast";
  if (value === "off") return null;
  return undefined;
}

export function configuredServiceTierRequestValue(value: ServiceTier | null): string | undefined {
  return value ?? undefined;
}
