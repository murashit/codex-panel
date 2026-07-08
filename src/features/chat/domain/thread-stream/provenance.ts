export type ThreadStreamItemProvenance =
  | {
      source: "appServer";
      channel: "turnItem";
      itemType: string;
      itemId: string;
    }
  | {
      source: "appServer";
      channel: "notification";
      event: "streamingDelta" | "taskProgress" | "hookRun" | "autoReview";
      sourceItemId?: string;
    }
  | {
      source: "localUser";
      channel: "optimistic" | "response";
      interaction: "prompt" | "steer" | "approvalResponse" | "userInputResponse";
      sourceId?: string;
    }
  | {
      source: "panel";
      channel: "notice";
      reason: "system" | "goalChange" | "parsedAutoReview" | "reviewMessage";
      sourceId?: string;
    }
  | {
      source: "panel";
      channel: "derived";
      synthesis: "steeringActivity";
      sourceItemId: string;
    };
