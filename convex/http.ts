import { httpRouter } from "convex/server";
import { gateway } from "./mcpGateway";
// Auth 2 retains its component-managed sessions. This route grants only the
// fixed scoped MCP operations, never a general Convex/human session.
const router = httpRouter();
router.route({path: "/integrations/mcp-tools", method: "POST", handler: gateway});
export default router;
