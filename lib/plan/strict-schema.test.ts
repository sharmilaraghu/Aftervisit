/**
 * The two schemas the model is asked to fill are sent in strict mode.
 *
 * Strict structured outputs accept a subset of JSON Schema: every property
 * listed in `required`, `additionalProperties: false` on every object, and
 * that holds recursively through `items` and nested objects. A schema that
 * drifts out of the subset is refused by the API at request time, which reads
 * to a clinician as "the note could not be compiled" with no clue why. This
 * test is the clue, moved to before the commit.
 */

import { describe, expect, it } from "vitest";

import { COMPILE_SCHEMA, compilePrompt } from "@/lib/plan/compile";
import { TRIAGE_SCHEMA } from "@/lib/triage/schema";

type Node = Record<string, unknown>;

function objectNodes(node: unknown, path: string, out: { path: string; node: Node }[]) {
  if (typeof node !== "object" || node === null) return out;
  const n = node as Node;
  const types = Array.isArray(n.type) ? n.type : [n.type];
  if (types.includes("object")) out.push({ path, node: n });
  if (typeof n.properties === "object" && n.properties !== null) {
    for (const [key, child] of Object.entries(n.properties as Node)) {
      objectNodes(child, `${path}.${key}`, out);
    }
  }
  if (n.items) objectNodes(n.items, `${path}[]`, out);
  return out;
}

describe.each([
  ["COMPILE_SCHEMA", COMPILE_SCHEMA],
  ["TRIAGE_SCHEMA", TRIAGE_SCHEMA],
])("%s is strict-mode safe", (_name, schema) => {
  const objects = objectNodes(schema, "$", []);

  it("has at least the root object", () => {
    expect(objects.length).toBeGreaterThan(0);
  });

  it.each(objects.map((o) => [o.path, o.node] as const))(
    "%s lists every property as required and forbids extras",
    (_path, node) => {
      const keys = Object.keys((node.properties ?? {}) as Node).sort();
      expect([...((node.required ?? []) as string[])].sort()).toEqual(keys);
      expect(node.additionalProperties).toBe(false);
    },
  );
});

describe("compilePrompt", () => {
  const note = "Started metformin today. Call daily for a week and ask about nausea.";

  it("labels the visit kind so rule 8 has something to point at", () => {
    const prompt = compilePrompt({ noteBody: note, visitKind: "post_op" });
    expect(prompt).toContain("VISIT KIND\n\npost-operative follow-up");
    expect(prompt.startsWith(note)).toBe(true);
  });

  it("says nothing about the visit when nobody said what kind it was", () => {
    expect(compilePrompt({ noteBody: note })).not.toContain("VISIT KIND");
  });
});
