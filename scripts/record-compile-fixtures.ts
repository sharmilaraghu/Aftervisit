/**
 * Record the compiler's real answer for each fixture note.
 *
 * `lib/plan/compile-fixtures.test.ts` then runs the pure post-model pipeline
 * (`processCompiledAnswer`) against these recordings, so the tests pin
 * grounding, defaults, anchors and coverage on a genuine model answer without
 * calling a model. They pin the pipeline, not the live model: re-record when
 * the compile prompt or schema changes.
 *
 *   pnpm tsx scripts/record-compile-fixtures.ts
 *
 * Calls OpenAI only. Never CALL-E, and never dials anyone.
 */

import { config } from "dotenv";

config({ path: ".env" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compileNote } from "../lib/plan/compile";
import { FIXTURE_NOTES } from "../lib/plan/fixtures/notes";

const DIR = join(process.cwd(), "lib/plan/fixtures");

async function main() {
  mkdirSync(DIR, { recursive: true });
  for (const note of FIXTURE_NOTES) {
    const outcome = await compileNote({ noteBody: note.noteBody, visitKind: note.visitKind });
    if (!outcome.ok) {
      console.error(`  ${note.name}: not recorded — ${outcome.reason}: ${outcome.detail}`);
      process.exitCode = 1;
      continue;
    }
    writeFileSync(
      join(DIR, `${note.name}.json`),
      `${JSON.stringify({ model: outcome.model, recordedAt: new Date().toISOString(), raw: outcome.raw }, null, 2)}\n`,
    );
    console.log(`  ${note.name}: recorded (${outcome.model})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
