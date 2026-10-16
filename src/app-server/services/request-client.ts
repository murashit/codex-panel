import type { ClientResponseByMethod, TypedClientRequestMethod } from "../connection/client";
import type { ClientRequestParams } from "../connection/rpc-messages";

export interface AppServerRequestClient {
  request<M extends TypedClientRequestMethod>(
    method: M,
    params: ClientRequestParams<M>,
    options?: { timeoutMs?: number; onResponse?: (response: ClientResponseByMethod[M]) => void },
  ): Promise<ClientResponseByMethod[M]>;
}
