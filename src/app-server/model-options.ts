import { AppServerClient } from "./client";
import { panelModelOptionsFromAppServerModels } from "./catalog-model";
import type { PanelModelOption } from "../domain/catalog/metadata";

export async function loadPanelModelOptions(codexPath: string, cwd: string, includeHidden = false): Promise<PanelModelOption[]> {
  let client!: AppServerClient;
  client = new AppServerClient(codexPath, cwd, {
    onNotification: () => undefined,
    onServerRequest: (request) => {
      client.rejectServerRequest(request.id, -32601, "Model option loading does not handle server requests.");
    },
    onLog: () => undefined,
    onExit: () => undefined,
  });

  try {
    await client.connect();
    const response = await client.listModels(includeHidden);
    return panelModelOptionsFromAppServerModels(response.data);
  } finally {
    client.disconnect();
  }
}
