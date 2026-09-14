/**
 * The model, behind one door.
 *
 * OpenAI, and only OpenAI. Which model actually ran is still returned and
 * persisted, because "compiled by gpt-4.1-mini" is a checkable claim about a
 * note and "compiled by a model" is not.
 *
 * Every request is a strict structured output: the schema is enforced by the
 * API, so the model cannot omit a field, add one, or hand back prose around
 * the JSON. It is never asked to make a clinical decision, and never given the
 * ability to: every defaultable field is a nullable slot, and code fills the
 * nulls afterwards.
 */

import type { JsonObject } from "@call-e/calle";

import type { CompileProvider } from "@/lib/db/enums";

export interface CompletionRequest {
  system: string;
  user: string;
  /** Strict-mode JSON Schema: every key required, `additionalProperties: false` throughout. */
  schema: JsonObject;
  /** The format's name on the wire. `a-z A-Z 0-9 _ -`, at most 64 characters. */
  name: string;
}

export interface CompletionResult {
  provider: CompileProvider;
  model: string;
  /** The model's answer, parsed but otherwise untouched — nulls intact. */
  raw: unknown;
}

export class NoProviderError extends Error {
  constructor() {
    super(
      "No model is configured. Set OPENAI_API_KEY to compile a note. AfterVisit will " +
        "not invent a follow-up plan without one.",
    );
    this.name = "NoProviderError";
  }
}

export const OPENAI_MODEL = "gpt-4.1-mini";

async function callOpenAI(req: CompletionRequest, apiKey: string): Promise<CompletionResult> {
  // Imported lazily so the test suite never loads the SDK.
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    // The compiler is an extraction task, not a creative one. The same note
    // should produce the same plan twice.
    temperature: 0,
    instructions: req.system,
    input: req.user,
    text: {
      format: { type: "json_schema", name: req.name, schema: req.schema, strict: true },
    },
  });

  /*
   * A refusal arrives as its own content part, and `output_text` is then empty
   * — which would surface as "Unexpected end of JSON input" and tell the
   * clinician nothing. Read the refusal first so they get the model's reason.
   */
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type === "refusal") {
        throw new Error(`The model declined to answer: ${part.refusal}`);
      }
    }
  }

  if (response.status !== "completed") {
    const why = response.incomplete_details?.reason ?? response.status ?? "unknown";
    throw new Error(`OpenAI did not finish the answer (${why}).`);
  }

  if (!response.output_text) throw new Error("OpenAI returned an empty response.");
  return { provider: "openai", model: OPENAI_MODEL, raw: JSON.parse(response.output_text) };
}

/**
 * Run the request against the model, or refuse.
 *
 * A failure surfaces as a refusal the clinician reads — never as a generic plan,
 * and never as a quiet call.
 */
export async function complete(
  req: CompletionRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CompletionResult> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new NoProviderError();
  return callOpenAI(req, apiKey);
}

/** Whether a compile can even be attempted. Used to show an honest refusal up front. */
export function hasProvider(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPENAI_API_KEY);
}
