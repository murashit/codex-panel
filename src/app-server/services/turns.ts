import type { CodexInput } from "../../domain/input/input";
import type { ClientResponseByMethod } from "../connection/client";
import type { ClientRequestParams } from "../connection/rpc-messages";
import { appServerTurnInputFromCodexInput } from "../protocol/request-input";
import type { AppServerRequestClient } from "./request-client";
import type { RuntimeOverride } from "./runtime-overrides";

export interface AppServerStartTurnOptions {
  threadId: string;
  cwd: string;
  input: CodexInput;
  clientUserMessageId: string;
}

export interface AppServerStartStructuredTurnOptions {
  threadId: string;
  cwd: string;
  text: string;
  outputSchema: NonNullable<ClientRequestParams<"turn/start">["outputSchema"]>;
  runtime: RuntimeOverride;
}

export type AppServerSteerDispatch =
  | { readonly kind: "dispatched"; readonly completion: Promise<unknown> }
  | { readonly kind: "not-dispatched"; readonly error: unknown };

export function startTurn(
  client: AppServerRequestClient,
  options: AppServerStartTurnOptions,
): Promise<ClientResponseByMethod["turn/start"]> {
  const { threadId, cwd, input, clientUserMessageId } = options;
  const prepared = appServerTurnInputFromCodexInput(input, clientUserMessageId);
  const params: ClientRequestParams<"turn/start"> = {
    threadId,
    cwd,
    clientUserMessageId,
    ...(prepared.additionalContext !== undefined ? { additionalContext: prepared.additionalContext } : {}),
    input: prepared.input,
  };
  return client.request("turn/start", params);
}

export function startStructuredTurn(
  client: AppServerRequestClient,
  options: AppServerStartStructuredTurnOptions,
): Promise<ClientResponseByMethod["turn/start"]> {
  const { threadId, cwd, text, outputSchema, runtime } = options;
  const params: ClientRequestParams<"turn/start"> = {
    threadId,
    cwd,
    input: [
      {
        type: "text",
        text,
        text_elements: [],
      },
    ],
    outputSchema,
    ...runtime,
  };
  return client.request("turn/start", params);
}

export function steerTurn(
  client: AppServerRequestClient,
  threadId: string,
  expectedTurnId: string,
  input: CodexInput,
  clientUserMessageId: string,
): AppServerSteerDispatch {
  try {
    const prepared = appServerTurnInputFromCodexInput(input, clientUserMessageId);
    return {
      kind: "dispatched",
      completion: client.request("turn/steer", {
        threadId,
        expectedTurnId,
        input: prepared.input,
        clientUserMessageId,
        ...(prepared.additionalContext !== undefined ? { additionalContext: prepared.additionalContext } : {}),
      }),
    };
  } catch (error) {
    return { kind: "not-dispatched", error };
  }
}

export function interruptTurn(client: AppServerRequestClient, threadId: string, turnId: string): Promise<unknown> {
  return client.request("turn/interrupt", { threadId, turnId });
}
