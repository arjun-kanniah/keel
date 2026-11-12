// Applies db/migrations/*.sql in order, each once, each in its own transaction.
// Used locally (`just migrate`), in CI, and by the deploy's migrate job.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export async function migrate(url = process.env.DATABASE_URL ?? "postgresql://keel:keel@localhost:5434/keel") {
  const dir = path.join(import.meta.dirname, "..", "db", "migrations");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // One migrator at a time, even if two deploys overlap
    await client.query("SELECT pg_advisory_lock(7135)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(path.join(dir, file), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`applied ${file}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`${file}: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
