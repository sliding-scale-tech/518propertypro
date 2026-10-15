"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/toast";
import { Modal, btnDanger, btnOutline, cleanError } from "@/components/maintenance/shared";
import { ResidentModal, type ResidentFormValue, type UnitOption } from "./resident-modal";

export type ResidentRow = {
  _id: Id<"residents">;
  unitId: Id<"units">;
  fullName: string;
  phones?: string[];
  email?: string;
  leaseEnd?: string;
};

/**
 * Edit + deactivate flows shared by the list and the detail page. Render `dialogs` once and
 * call `edit` / `deactivate` from buttons. Only mount for the admin view; the server enforces it.
 */
export function useResidentActions(onDeactivated?: () => void) {
  const toast = useToast();
  const units = useQuery(api.units.list, {});
  const properties = useQuery(api.properties.list);
  const update = useMutation(api.residents.update);
  const deactivateM = useMutation(api.residents.deactivate);
  const [editing, setEditing] = useState<ResidentRow | null>(null);
  const [confirming, setConfirming] = useState<ResidentRow | null>(null);
  const [busy, setBusy] = useState(false);

  const unitOptions: UnitOption[] = useMemo(() => {
    const names = new Map((properties ?? []).map((p) => [p._id as string, p.name]));
    return (units ?? []).map((u) => ({
      id: u._id,
      label: `${names.get(u.propertyId) ?? "Property"} · Unit ${u.unitNumber}`,
    }));
  }, [units, properties]);

  const dialogs = (
    <>
      {editing ? (
        <ResidentModal
          title="Edit resident"
          unitOptions={unitOptions}
          busy={busy}
          initial={{
            unitId: editing.unitId,
            fullName: editing.fullName,
            phones: editing.phones ?? [],
            email: editing.email ?? "",
            leaseEnd: editing.leaseEnd ?? "",
          }}
          onClose={() => setEditing(null)}
          onSubmit={async (v: ResidentFormValue) => {
            setBusy(true);
            try {
              await update({
                residentId: editing._id,
                unitId: v.unitId as Id<"units">,
                fullName: v.fullName,
                phones: v.phones,
                ...(v.email ? { email: v.email } : { clearEmail: true }),
                ...(v.leaseEnd ? { leaseEnd: v.leaseEnd } : { clearLeaseEnd: true }),
              });
              toast("Resident updated");
              setEditing(null);
            } catch (err) {
              toast(cleanError(err), "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
      {confirming ? (
        <Modal title={`Deactivate ${confirming.fullName}?`} onClose={() => setConfirming(null)}>
          <p className="text-sm text-muted-foreground">
            Their phone numbers stop matching incoming calls. The record and history are kept.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnOutline} onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              className={btnDanger}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await deactivateM({ residentId: confirming._id });
                  toast("Resident deactivated");
                  setConfirming(null);
                  onDeactivated?.();
                } catch (err) {
                  toast(cleanError(err), "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Deactivate
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );

  return { unitOptions, edit: setEditing, deactivate: setConfirming, dialogs };
}
