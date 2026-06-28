import type { AppServerRequestClient } from "./request-client";

export async function readFileBase64(client: AppServerRequestClient, path: string, options: { timeoutMs?: number } = {}): Promise<string> {
  const response = await client.request("fs/readFile", { path }, options);
  return response.dataBase64;
}
