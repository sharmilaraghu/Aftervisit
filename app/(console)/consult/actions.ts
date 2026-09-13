"use server";

/**
 * The doctor's two acts on a visit that are not writing its note.
 *
 * A patient who never arrives used to sit on the list as "waiting" forever —
 * and the next morning as "from earlier days", looking like work the doctor
 * had skipped. Marking the no-show clears it honestly and hands the patient
 * back to the front desk, where the roster still says they need a plan.
 */

import { revalidatePath } from "next/cache";

import { markVisitNoShow, reopenVisit } from "@/lib/db/visits";

export async function markNoShowAction(visitId: string): Promise<void> {
  await markVisitNoShow(visitId);
  revalidatePath("/consult");
  revalidatePath("/patients");
}

export async function reopenVisitAction(visitId: string): Promise<void> {
  await reopenVisit(visitId);
  revalidatePath("/consult");
  revalidatePath("/patients");
}
