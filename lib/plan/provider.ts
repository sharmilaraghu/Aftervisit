/**
 * The model, behind one door.
 *
 * Gemini is primary; OpenAI is a fallback used only when Gemini is unset or
 * errors. Which one actually ran is returned and persisted, because "Gemini
 * with an OpenAI fallback" is otherwise an unverifiable claim about a system
 * nobody can inspect after the fact.
 *
 * Both are asked for strict JSON against the same schema. Neither is asked to
 * make a clinical decision, and neither is given the ability to: the schema it
 * fills in has a nullable slot for every defaultable field, and code fills the
 * nulls afterwards.
 */

import type { JsonObject } from "@call-e/calle";

import type { CompileProvider } from "@/lib/db/enums";

export interface CompletionRequest {
  system: string;
  user: string;
  schema: JsonObject;
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
      "No model is configured. Set GEMINI_API_KEY (or OPENAI_API_KEY) to compile a " +
        "note. Care Loop will not invent a follow-up plan without one.",
    );
    this.name = "NoProviderError";
  }
}

export const GEMINI_MODEL = "gemini-2.5-flash";
export const OPENAI_MODEL = "gpt-4.1-mini";

function firstJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some models fence their JSON even when told not to. Recover rather than
    // discard a compile the clinician is waiting on.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("The model did not return JSON.");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

async function callGemini(req: CompletionRequest, apiKey: string): Promise<CompletionResult> {
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey });

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: req.user }] }],
    config: {
      systemInstruction: req.system,
      responseMimeType: "application/json",
      responseJsonSchema: req.schema,
      // The compiler is an extraction task, not a creative one. The same note
      // should produce the same plan twice.
      temperature: 0,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response.");
  return { provider: "gemini", model: GEMINI_MODEL, raw: firstJsonObject(text) };
}

async function callOpenAI(req: CompletionRequest, apiKey: string): Promise<CompletionResult> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${req.system}\n\nReturn JSON matching this schema:\n${JSON.stringify(req.schema)}` },
      { role: "user", content: req.user },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned an empty response.");
  return { provider: "openai", model: OPENAI_MODEL, raw: firstJsonObject(text) };
}

/**
 * Run the compile against whichever model is available.
 *
 * A Gemini failure falls through to OpenAI rather than surfacing, because the
 * clinician's job is to review a plan and the provider is not their problem.
 * Both failing does surface — as a refusal, never as a generic plan.
 */
export async function complete(
  req: CompletionRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CompletionResult> {
  const gemini = env.GEMINI_API_KEY;
  const openai = env.OPENAI_API_KEY;

  if (!gemini && !openai) throw new NoProviderError();

  if (gemini) {
    try {
      return await callGemini(req, gemini);
    } catch (error) {
      if (!openai) throw error;
      // Recorded on the note as `compileProvider: "openai"`, so the fallback is
      // visible after the fact rather than inferred.
      console.warn("Gemini compile failed, falling back to OpenAI:", error);
    }
  }

  return callOpenAI(req, openai!);
}

/** Whether a compile can even be attempted. Used to show an honest refusal up front. */
export function hasProvider(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GEMINI_API_KEY || env.OPENAI_API_KEY);
}
