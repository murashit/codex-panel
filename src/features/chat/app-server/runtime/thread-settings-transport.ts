import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import type { RuntimeSettingsTransport } from "../../application/runtime/settings-transport";
import type { CurrentChatAppServerClientHost } from "../client-scope";
import { withCurrentChatAppServerClient } from "../client-scope";

export function createChatRuntimeSettingsTransport(host: CurrentChatAppServerClientHost): RuntimeSettingsTransport {
  return {
    updateThreadSettings: async (threadId: string, update: RuntimeSettingsPatch) => {
      const result = await withCurrentChatAppServerClient(host, async (client) => {
        await client.updateThreadSettings(threadId, update);
        return true;
      });
      return result ?? false;
    },
  };
}
