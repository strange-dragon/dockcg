import { DockcgServer } from "./dockcg-server";
import { Express, Router as ExpressRouter } from "express";

export abstract class Router {
    abstract create(app : Express, server : DockcgServer): ExpressRouter;
}
