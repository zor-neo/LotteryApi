import { Env } from "./env.js";
import { handleRequest } from "./api/routes.js";
import { handleScheduled } from "./worker/scheduled.js";

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handleRequest(request, env, ctx);
  },

  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env));
  },
};
