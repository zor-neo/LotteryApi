import { neon } from "@neondatabase/serverless";
import { Env } from "../env.js";

export async function query<T = unknown>(env: Env, text: string, params: unknown[] = []): Promise<T[]> {
  const sql = neon(env.DATABASE_URL);
  return (await sql.query(text, params)) as T[];
}

export async function one<T = unknown>(env: Env, text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(env, text, params);
  return rows[0] ?? null;
}
