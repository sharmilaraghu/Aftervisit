/**
 * Retired.
 *
 * The dashboard and the roster read the same query and wrote near-identical
 * headlines — two front doors to one room, which is what made the console
 * confusing. The roster is now the clinician's view and carries the
 * practice-level numbers.
 *
 * Kept as a redirect rather than deleted: the landing page, bookmarks and
 * anything already pointing here should land somewhere useful instead of a 404.
 */

import { redirect } from "next/navigation";

export default function DashboardPage() {
  redirect("/patients");
}
