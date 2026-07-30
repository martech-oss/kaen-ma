import type { Hono } from "hono";

import type { AppEnvironment } from "../env";
import { getWorkspace } from "./service";

export function registerWorkspaceRoutes(api: Hono<AppEnvironment>): void {
  api.get("/workspace", async (context) => {
    const workspace = await getWorkspace(context.get("database"), context.get("workspace"));
    return context.json({ data: workspace });
  });
}
