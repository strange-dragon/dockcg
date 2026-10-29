import { DockcgServer } from "./dockcg-server";
import { DockcgSocket } from "./util-server";

export abstract class SocketHandler {
    abstract create(socket : DockcgSocket, server : DockcgServer): void;
}
