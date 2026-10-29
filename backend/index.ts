import { DockcgServer } from "./dockcg-server";
import { log } from "./log";

log.info("server", "Welcome to dockcg!");
const server = new DockcgServer();
await server.serve();
