import type { AppServerClient } from "../../app-server/connection/client";
import { normalizeExplicitThreadName } from "../../domain/threads/model";

export interface RenameThreadResult {
  name: string;
}

export interface ThreadRename {
  name: string;
}

export function threadRenameFromValue(value: string): ThreadRename | null {
  const name = normalizeExplicitThreadName(value);
  return name ? { name } : null;
}

export async function renameThreadOnAppServer(
  client: AppServerClient,
  threadId: string,
  rename: ThreadRename,
): Promise<RenameThreadResult> {
  await client.setThreadName(threadId, rename.name);
  return { name: rename.name };
}
