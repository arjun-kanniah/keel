import pg from "pg";
import { migrate } from "../../scripts/migrate";

// Tests use their own database (keel_test), created and migrated fresh for each run.
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://keel:keel@localhost:5434/keel_test");
  const name = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${name}`);
  await c.end();
  await migrate(url.toString());
}
