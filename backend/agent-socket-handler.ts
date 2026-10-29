import { DockcgServer } from "./dockcg-server";
import { AgentSocket } from "../common/agent-socket";
import { DockcgSocket } from "./util-server";

export abstract class AgentSocketHandler {
    abstract create(socket : DockcgSocket, server : DockcgServer, agentSocket : AgentSocket): void;
}
