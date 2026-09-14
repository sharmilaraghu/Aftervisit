/**
 * The old plan review page.
 *
 * There is nothing left to review: the doctor saves the note and the follow-up
 * starts. Links to a plan still resolve, to the plan section of the patient's
 * follow-up page, so no bookmark or older link lands on a 404.
 */

import { notFound, redirect } from "next/navigation";

import { getPlanForReview } from "@/lib/db/plans";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await getPlanForReview(id);
  if (!plan) notFound();
  redirect(`/followups/${plan.patientId}#plan`);
}
