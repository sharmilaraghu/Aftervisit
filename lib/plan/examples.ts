/**
 * The style guide the compiler is shown: what a good follow-up question looks
 * like, one set per condition.
 *
 * Style, not a list. The prompt says so, and `lib/plan/coverage.ts` flags any
 * question that comes back word-for-word identical to one of these — the tell
 * of a model copying a template instead of reading the note.
 *
 * Every example is phrased to stand alone (no "since we last spoke"), asks one
 * thing, has a closed answer, and names no medication: a drug name here could
 * be copied into a question for a note that never mentions it, and question
 * prompts are not grounded against medications.
 */

export const EXAMPLE_QUESTIONS: Record<string, { prompt: string; answer: string }[]> = {
  new_metformin: [
    { prompt: "Have you been able to take the new tablets as prescribed?", answer: "yes / no" },
    { prompt: "Have you had an upset stomach or felt sick since starting them?", answer: "yes / no" },
  ],
  heart_failure: [
    { prompt: "Are you more out of breath than usual when you walk around the house?", answer: "yes / no" },
    { prompt: "Are your ankles more swollen than usual?", answer: "yes / no" },
  ],
  statin_tolerance: [
    { prompt: "Have you had any new muscle aches or weakness?", answer: "yes / no" },
    { prompt: "On a scale of 0 to 10, how bad are any muscle aches today?", answer: "0–10" },
  ],
  post_op_wound: [
    { prompt: "Is there any discharge coming from the wound?", answer: "yes / no" },
    { prompt: "Is the skin around the wound getting redder?", answer: "yes / no" },
    { prompt: "On a scale of 0 to 10, how bad is the pain today?", answer: "0–10" },
  ],
  asthma: [
    {
      prompt: "How many times did you need your reliever inhaler yesterday — none, once or twice, or three or more?",
      answer: "none / once or twice / three or more",
    },
  ],
  post_discharge: [
    { prompt: "Are you able to get around the house as well as when you left hospital?", answer: "yes / no" },
  ],
  blood_pressure: [
    { prompt: "Have you felt dizzy when standing up?", answer: "yes / no" },
  ],
  thyroid: [
    { prompt: "Have you noticed your heart racing or pounding?", answer: "yes / no" },
  ],
};

/** Every example prompt, for the template-copy check. */
export const EXAMPLE_PROMPTS: string[] = Object.values(EXAMPLE_QUESTIONS).flatMap((set) =>
  set.map((e) => e.prompt),
);

/** The block inlined into the compiler's system prompt. */
export const EXAMPLES_BLOCK: string = Object.entries(EXAMPLE_QUESTIONS)
  .map(
    ([condition, set]) =>
      `${condition}:\n${set.map((e) => `  - "${e.prompt}" (${e.answer})`).join("\n")}`,
  )
  .join("\n");
