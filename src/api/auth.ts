import { Env } from "../env.js";
import { findApiKey } from "../domain/repository.js";

export async function requireApiKey(request: Request, env: Env): Promise<Response | null> {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) return new Response(JSON.stringify({ error: "Missing x-api-key" }), { status: 401 });
  if (env.DEFAULT_API_KEY && apiKey === env.DEFAULT_API_KEY) return null;
  const key = await findApiKey(env, apiKey);
  return key ? null : new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 });
}
