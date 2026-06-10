import type { Turn } from "../generated/app-server/v2/Turn";

export interface ThreadTurnsPage {
  data: readonly Turn[];
  nextCursor: string | null;
}
