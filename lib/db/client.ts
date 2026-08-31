/**
 * The database handle, created lazily.
 *
 * Lazy because the test suite and every pure module must keep running with no
 * credentials at all. Reading `DATABASE_URL` at import time would make merely
 * importing a query module fail on a machine that has never seen the .env.
 *
 * The Neon HTTP driver gives one implicit transaction per statement. That is
 * the constraint the whole schema is designed around: there is no
 * `db.transaction()` here, and adding one would silently be a lie.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "@/lib/db/schema";

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super(
      "DATABASE_URL is not set. Care Loop will not start with an in-memory " +
        "stand-in — a console that renders empty because it has no database " +
        "looks identical to a practice where nobody is drifting.",
    );
    this.name = "MissingDatabaseUrlError";
  }
}

let cached: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) throw new MissingDatabaseUrlError();

  cached = drizzle(neon(url), { schema });
  return cached;
}

/** True when a database is configured. For rendering an honest message, not for branching logic. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
