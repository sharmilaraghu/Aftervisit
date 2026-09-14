/**
 * How a patient is doing, in one word the doctor can act on.
 *
 * Derived, never stored. Every input already exists — the open escalation, the
 * latest triage verdict for this plan, the plan's derived health — so a stored
 * status would only be a second copy that could disagree with the escalations
 * it summarises.
 *
 * Four states, and the third is not decoration. "Patient is fine" and "needs
 * attention" were asked for; but a patient nobody has reached cannot honestly
 * be either, and showing them as fine is the exact failure AfterVisit exists to
 * catch. So a silence gets its own name, stated as a fact.
 *
 *   needs_attention — an open escalation, or a silence gone on too long. A
 *                     triage outage fails closed into an escalation, so an
 *                     outage lands here too, never in "no concerns".
 *   finished        — the window ran out and nobody has closed the file.
 *   no_concerns     — the last call was read and raised nothing.
 *   no_word_yet     — nothing new to read: not called yet, not reached yet,
 *                     or the last concern was handled and the next call is due.
 *
 * Pure.
 */

import type { PlanHealth } from "@/lib/db/enums";

export type ClinicalStatus = "needs_attention" | "finished" | "no_concerns" | "no_word_yet";

export const CLINICAL_STATUS_LABEL: Record<ClinicalStatus, string> = {
  needs_attention: "Needs attention",
  finished: "Finished",
  no_concerns: "No concerns raised",
  no_word_yet: "No word yet",
};

export interface StatusInput {
  planStatus: string | null;
  health: PlanHealth;
  /** An escalation open or acknowledged, and so still the doctor's. */
  escalationOpen: boolean;
  /** What raised it, in the rule's or the reader's words. */
  escalationLabel: string | null;
  /** The latest triage verdict for this plan, or null when no call has been read. */
  latestVerdict: string | null;
  /**
   * Whether that call reached the patient. A low reading of a call nobody
   * answered is not "no concerns" — and that must hold in code, not only
   * because the triage prompt tells the model never to read silence as low.
   */
  latestReached: boolean;
  /** Completed because the window ran out, with no closing note yet. */
  finishedUnclosed: boolean;
  /** Calendar days since anyone answered, in the patient's zone. */
  quietFor: number | null;
}

export function clinicalStatus(input: StatusInput): ClinicalStatus {
  if (input.escalationOpen) return "needs_attention";
  /* A silence is a clinical fact, not a scheduling detail: it stays on the
     doctor's view as a status even though the call ladder behind it does not. */
  if (input.health === "drifting" || input.health === "never_reached") return "needs_attention";
  if (input.finishedUnclosed) return "finished";
  if (input.latestVerdict === "low" && input.latestReached) return "no_concerns";
  return "no_word_yet";
}

/** One line saying why, phrased as what happened to the patient, never as a schedule. */
export function statusReason(input: StatusInput, status: ClinicalStatus): string {
  switch (status) {
    case "needs_attention":
      if (input.escalationOpen) return input.escalationLabel ?? "Raised for a clinician";
      if (input.health === "never_reached") return "Never reached during the follow-up";
      return input.quietFor !== null
        ? `Not heard from in ${input.quietFor} ${input.quietFor === 1 ? "day" : "days"}`
        : "Not heard from";
    case "finished":
      return "Follow-up finished — close the file or restart";
    case "no_concerns":
      return "The last call raised nothing concerning";
    case "no_word_yet":
      if (input.planStatus === "awaiting_approval") return "Plan waiting for your approval";
      if (input.latestVerdict !== null && input.latestVerdict !== "low") {
        return "Handled — waiting for the next call";
      }
      return "No call has got through yet";
  }
}
