import type { Protocol } from "../../../../app-server/protocol/catalog";
import type { Host } from "../host/contracts";
import type { Workspace } from "../../../../workspace/panel-coordinator";

export type Escape = Protocol | Host | Workspace;
