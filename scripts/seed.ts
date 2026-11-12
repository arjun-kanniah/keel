// Local development: wipe all orgs and create one demo org. Prints the sign-in personas.
import { pool } from "../src/lib/db";
import { createOrg } from "../src/lib/ratebook/seed";

const c = await pool().connect();
try {
  await c.query("BEGIN");
  await c.query("SET LOCAL keel.purge = 'on'");
  await c.query("DELETE FROM orgs");
  await c.query("COMMIT");
} finally {
  c.release();
}
const org = await createOrg();
console.log(`Seeded ${org.orgId}: owner ${org.users.owner}, admin ${org.users.admin}, viewer ${org.users.viewer}`);
await pool().end();
