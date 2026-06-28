import type { CodexInput } from "../../domain/chat/input";
import type { ClientResponseByMethod } from "../connection/client";
import type { ClientRequestParams } from "../connection/rpc-messages";
import { additionalContextFromCodexInput, toAppServerUserInput } from "../protocol/request-input";
import type { AppServerRequestClient } from "./request-client";

type AppServerTurnRuntimeOverrides = Partial<AppServerTurnRuntimeParams>;

type AppServerTurnRuntimeParams = Pick<
  ClientRequestParams<"turn/start">,
  "serviceTier" | "collaborationMode" | "model" | "effort" | "approvalsReviewer"
>;

export interface AppServerStartTurnOptions {
  threadId: string;
  cwd: string;
  input: string | CodexInput;
  clientUserMessageId?: string | null;
  runtime?: AppServerTurnRuntimeOverrides;
}

export interface AppServerStartStructuredTurnOptions {
  threadId: string;
  cwd: string;
  text: string;
  outputSchema: NonNullable<ClientRequestParams<"turn/start">["outputSchema"]>;
  runtime?: AppServerTurnRuntimeOverrides;
}

export function startTurn(
  client: AppServerRequestClient,
  options: AppServerStartTurnOptions,
): Promise<ClientResponseByMethod["turn/start"]> {
  const { threadId, cwd, input, clientUserMessageId, runtime } = options;
  const additionalContext = toAdditionalContext(input);
  const params: ClientRequestParams<"turn/start"> = {
    threadId,
    cwd,
    ...(clientUserMessageId !== undefined ? { clientUserMessageId } : {}),
    ...(additionalContext !== undefined ? { additionalContext } : {}),
    ...appServerTurnRuntimeParams(runtime),
    input: toUserInput(input),
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
    ...appServerTurnRuntimeParams(runtime),
  };
  return client.request("turn/start", params);
}

export function steerTurn(
  client: AppServerRequestClient,
  threadId: string,
  expectedTurnId: string,
  input: string | CodexInput,
  clientUserMessageId?: string | null,
): Promise<unknown> {
  const additionalContext = toAdditionalContext(input);
  return client.request("turn/steer", {
    threadId,
    expectedTurnId,
    input: toUserInput(input),
    ...(clientUserMessageId !== undefined ? { clientUserMessageId } : {}),
    ...(additionalContext !== undefined ? { additionalContext } : {}),
  });
}

export function interruptTurn(client: AppServerRequestClient, threadId: string, turnId: string): Promise<unknown> {
  return client.request("turn/interrupt", { threadId, turnId });
}

function toUserInput(input: string | CodexInput): ClientRequestParams<"turn/start">["input"] {
  if (typeof input !== "string") return toAppServerUserInput(input);
  return toAppServerUserInput([{ type: "text", text: input }]);
}

function toAdditionalContext(input: string | CodexInput): ClientRequestParams<"turn/start">["additionalContext"] | undefined {
  if (typeof input === "string") return undefined;
  return additionalContextFromCodexInput(input);
}

function appServerTurnRuntimeParams(runtime: AppServerTurnRuntimeOverrides | undefined): AppServerTurnRuntimeParams {
  const params: AppServerTurnRuntimeParams = {};
  if (runtime?.serviceTier !== undefined) params.serviceTier = runtime.serviceTier;
  if (runtime?.collaborationMode !== undefined) params.collaborationMode = runtime.collaborationMode;
  if (runtime?.model !== undefined) params.model = runtime.model;
  if (runtime?.effort !== undefined) params.effort = runtime.effort;
  if (runtime?.approvalsReviewer !== undefined) params.approvalsReviewer = runtime.approvalsReviewer;
  return params;
}
