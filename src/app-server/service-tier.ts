export type ServiceTier = string;
export type ServiceTierRequest = string | null | undefined;

export interface ServiceTierMetadata {
  id: string;
  name: string;
}

export function parseServiceTier(value: unknown): ServiceTier | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

export function requestedServiceTierRequestValue(value: "fast" | "off" | null, fastServiceTierId = "fast"): string | null | undefined {
  if (value === "fast") return fastServiceTierId;
  if (value === "off") return null;
  return undefined;
}

export function configuredServiceTierRequestValue(value: ServiceTier | null): string | undefined {
  return value ?? undefined;
}

export function isFastServiceTier(value: ServiceTier | null | undefined, serviceTiers: readonly ServiceTierMetadata[] = []): boolean {
  if (!value) return false;
  if (value === "fast") return true;
  if (serviceTiers.length === 0) return value === "priority";
  return serviceTiers.some((tier) => tier.id === value && tier.name.trim().toLowerCase() === "fast");
}
