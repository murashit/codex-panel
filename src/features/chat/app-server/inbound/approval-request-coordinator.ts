import type { RequestId, ServerRequest } from "../../../../app-server/connection/rpc-messages";
import { serverRequestApprovalDecisionSignature, serverRequestApprovalResponse } from "../../../../app-server/routing/server-requests";
import type { ApprovalAction } from "../../../../domain/interaction-requests/model";

export type ApprovalServerRequest = Extract<
  ServerRequest,
  {
    method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" | "item/permissions/requestApproval";
  }
>;

export type ApprovalRequestOwner = "active" | "tracked-subagent";

interface ApprovalCorrelation {
  readonly method: ApprovalServerRequest["method"];
  readonly itemId: string;
  readonly approvalId: string | null;
  readonly decisionSignature: string;
}

interface ApprovalEndpoint {
  readonly request: ApprovalServerRequest;
  readonly owner: ApprovalRequestOwner;
  readonly settled: boolean;
}

interface ApprovalRequestGroup {
  readonly logicalRequestId: RequestId;
  readonly parentTurnId: string;
  readonly correlation: ApprovalCorrelation;
  readonly endpoints: readonly ApprovalEndpoint[];
  readonly decision: ApprovalAction | null;
  readonly uiResolved: boolean;
}

export interface ApprovalResponseDelivery {
  readonly requestId: RequestId;
  readonly response: unknown;
}

interface ApprovalDecisionPlan {
  readonly action: ApprovalAction;
  readonly deliveries: readonly ApprovalResponseDelivery[];
}

type ApprovalRequestRegistration =
  | { readonly kind: "new"; readonly logicalRequestId: RequestId }
  | { readonly kind: "coalesced"; readonly logicalRequestId: RequestId }
  | { readonly kind: "answered"; readonly deliveries: readonly ApprovalResponseDelivery[] };

interface ApprovalRequestSettlement {
  readonly logicalRequestId: RequestId;
  readonly uiResolved: boolean;
  readonly allKnownEndpointsSettled: boolean;
}

export interface ApprovalRequestCoordinator {
  register(request: ApprovalServerRequest, owner: ApprovalRequestOwner, parentTurnId: string): ApprovalRequestRegistration;
  decide(logicalRequestId: RequestId, action: ApprovalAction): ApprovalDecisionPlan | null;
  automaticDeliveries(): readonly ApprovalResponseDelivery[];
  markSettled(requestId: RequestId): ApprovalRequestSettlement | null;
  markUiResolved(logicalRequestId: RequestId): void;
  reconcile(parentTurnId: string | null, pendingLogicalRequestIds: ReadonlySet<RequestId>): readonly RequestId[];
  clear(): void;
}

export function createApprovalRequestCoordinator(): ApprovalRequestCoordinator {
  const groups = new Map<RequestId, ApprovalRequestGroup>();

  return {
    register(request, owner, parentTurnId) {
      const correlation = approvalCorrelation(request);
      const candidates = [...groups.values()].filter(
        (group) =>
          group.parentTurnId === parentTurnId &&
          sameCorrelation(group.correlation, correlation) &&
          group.endpoints.length === 1 &&
          group.endpoints[0]?.owner !== owner,
      );
      if (candidates.length === 1) {
        const group = candidates[0];
        if (group) {
          const next = {
            ...group,
            endpoints: [...group.endpoints, approvalEndpoint(request, owner)],
          };
          groups.set(group.logicalRequestId, next);
          return group.decision
            ? { kind: "answered", deliveries: unsettledDeliveries(next) }
            : { kind: "coalesced", logicalRequestId: group.logicalRequestId };
        }
      }

      const group: ApprovalRequestGroup = {
        logicalRequestId: request.id,
        parentTurnId,
        correlation,
        endpoints: [approvalEndpoint(request, owner)],
        decision: null,
        uiResolved: false,
      };
      groups.set(group.logicalRequestId, group);
      return { kind: "new", logicalRequestId: group.logicalRequestId };
    },

    decide(logicalRequestId, action) {
      const group = groups.get(logicalRequestId);
      if (!group) return null;
      const lockedAction = group.decision ?? action;
      const decided: ApprovalRequestGroup = group.decision ? group : { ...group, decision: lockedAction };
      groups.set(logicalRequestId, decided);
      return { action: lockedAction, deliveries: unsettledDeliveries(decided) };
    },

    automaticDeliveries() {
      return [...groups.values()].flatMap((group) => (group.decision && group.uiResolved ? unsettledDeliveries(group) : []));
    },

    markSettled(requestId) {
      const group = [...groups.values()].find((candidate) => candidate.endpoints.some((endpoint) => endpoint.request.id === requestId));
      if (!group) return null;
      const endpoints = group.endpoints.map((endpoint) => (endpoint.request.id === requestId ? { ...endpoint, settled: true } : endpoint));
      const settled = { ...group, endpoints };
      const allKnownEndpointsSettled = endpoints.every((endpoint) => endpoint.settled);
      if (shouldRetainSettledGroup(settled, allKnownEndpointsSettled)) {
        groups.set(group.logicalRequestId, settled);
      } else if (allKnownEndpointsSettled) {
        groups.delete(group.logicalRequestId);
      } else {
        groups.set(group.logicalRequestId, settled);
      }
      return {
        logicalRequestId: group.logicalRequestId,
        uiResolved: group.uiResolved,
        allKnownEndpointsSettled,
      };
    },

    markUiResolved(logicalRequestId) {
      const group = groups.get(logicalRequestId);
      if (group) groups.set(logicalRequestId, { ...group, uiResolved: true });
    },

    reconcile(parentTurnId, pendingLogicalRequestIds) {
      const abandonedLogicalRequestIds: RequestId[] = [];
      for (const [logicalRequestId, group] of groups) {
        if (group.parentTurnId !== parentTurnId || (!group.uiResolved && !pendingLogicalRequestIds.has(group.logicalRequestId))) {
          groups.delete(logicalRequestId);
          if (!group.uiResolved) abandonedLogicalRequestIds.push(group.logicalRequestId);
        }
      }
      return abandonedLogicalRequestIds;
    },

    clear() {
      groups.clear();
    },
  };
}

export function isApprovalServerRequest(request: ServerRequest): request is ApprovalServerRequest {
  return (
    request.method === "item/commandExecution/requestApproval" ||
    request.method === "item/fileChange/requestApproval" ||
    request.method === "item/permissions/requestApproval"
  );
}

function approvalEndpoint(request: ApprovalServerRequest, owner: ApprovalRequestOwner): ApprovalEndpoint {
  return { request, owner, settled: false };
}

function approvalCorrelation(request: ApprovalServerRequest): ApprovalCorrelation {
  return {
    method: request.method,
    itemId: request.params.itemId,
    approvalId:
      request.method === "item/commandExecution/requestApproval" && typeof request.params.approvalId === "string"
        ? request.params.approvalId
        : null,
    decisionSignature: serverRequestApprovalDecisionSignature(request),
  };
}

function unsettledDeliveries(group: ApprovalRequestGroup): ApprovalResponseDelivery[] {
  const decision = group.decision;
  if (!decision) return [];
  return group.endpoints
    .filter((endpoint) => !endpoint.settled)
    .map((endpoint) => ({
      requestId: endpoint.request.id,
      response: serverRequestApprovalResponse(endpoint.request, decision),
    }));
}

function shouldRetainSettledGroup(group: ApprovalRequestGroup, allKnownEndpointsSettled: boolean): boolean {
  return allKnownEndpointsSettled && group.decision !== null && group.endpoints.length === 1;
}

function sameCorrelation(left: ApprovalCorrelation, right: ApprovalCorrelation): boolean {
  return (
    left.method === right.method &&
    left.itemId === right.itemId &&
    left.approvalId === right.approvalId &&
    left.decisionSignature === right.decisionSignature
  );
}
