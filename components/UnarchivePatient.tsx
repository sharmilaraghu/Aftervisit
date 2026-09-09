"use client";

/**
 * Undo an archive.
 *
 * Archiving stops the dialer with one column flip and was, until now, a
 * one-way door: nothing anywhere set `archived_at` back to null, the patient
 * left every list, and their edit page returned a 404. A reversible act that
 * cannot be reversed is just a slower delete.
 *
 * No arming. Putting a record back is not destructive, and asking "are you
 * sure?" before an undo is how a product teaches people to click through
 * confirmations without reading them.
 */

import { useTransition } from "react";

import { Button } from "@/components/ui";
import { unarchivePatientAction } from "@/app/(console)/patients/actions";

export function UnarchivePatient({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(() => unarchivePatientAction(id))}
    >
      {pending ? "Restoring…" : "Put them back on the roster"}
    </Button>
  );
}
