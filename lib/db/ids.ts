/**
 * Client-generated, prefixed ids.
 *
 * Not cosmetic. With no transactions on the Neon HTTP driver, the idempotent
 * write is `INSERT … ON CONFLICT DO NOTHING RETURNING id`, which returns *zero
 * rows* on conflict. If the database generated the id, discovering what you
 * collided with would need a second round trip. Generating it here makes every
 * idempotent insert one statement.
 *
 * The prefix also guarantees no `:` ever appears inside an id, which keeps the
 * idempotency key `${planId}:o${occurrence}:a${attempt}` parseable by splitting.
 */

export type IdPrefix =
  | "pat"
  | "note"
  | "pln"
  | "q"
  | "sc"
  | "slot"
  | "esc"
  | "tick";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * The CALL-E idempotency key for one dial.
 *
 * Business-stable, never a UUID: the same occurrence and attempt must produce
 * the same key on every retry of the *dispatch*, so CALL-E dedupes a double
 * send even if our own row was claimed twice.
 */
export function idempotencyKey(
  planId: string,
  occurrence: number,
  attempt: number,
): string {
  return `${planId}:o${occurrence}:a${attempt}`;
}
