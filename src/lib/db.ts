import pg from "pg";
import { config } from "./config";

// numeric comes back as a string by default; profiles' multipliers are small, so a float is fine
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

const globalForPool = globalThis as unknown as { keelPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!globalForPool.keelPool) {
    globalForPool.keelPool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
    });
  }
  return globalForPool.keelPool;
}

export type Db = pg.Pool | pg.PoolClient;

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Db = pool(),
): Promise<T[]> {
  const res = await db.query<T>(sql, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Db = pool(),
): Promise<T | undefined> {
  return (await q<T>(sql, params, db))[0];
}

/** Run fn in one transaction; rolls back on any thrown error. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
