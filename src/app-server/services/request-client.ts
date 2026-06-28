import type { ClientResponseByMethod, TypedClientRequestMethod } from "../connection/client";
import type { ClientRequestParams } from "../connection/rpc-messages";

export interface AppServerRequestClient {
  request<M extends TypedClientRequestMethod>(
    method: M,
    params: ClientRequestParams<M>,
    options?: { timeoutMs?: number },
  ): Promise<ClientResponseByMethod[M]>;
}
