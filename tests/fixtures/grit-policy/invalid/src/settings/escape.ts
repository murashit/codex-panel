import type { Generated } from "../generated/app-server/types";

export async function read(client: { request(method: string): Promise<void> }): Promise<void> {
  await client.request("config/read");
}

export type Escape = Generated;
