export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      ...(init.headers || {}),
    },
  });
}

export function error(status: number, message: string): Response {
  return json({ error: message }, { status });
}
