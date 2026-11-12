import { one } from "./db";
import { tooMany } from "./errors";

/** Fixed one-hour windows in Postgres, so limits hold across instances. */
export async function hit(key: string, limit: number): Promise<void> {
  const r = await one<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, date_trunc('hour', now()), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key],
  );
  if (r && r.count > limit) throw tooMany(`That's ${limit} assistant requests this hour; try again later.`);
}
