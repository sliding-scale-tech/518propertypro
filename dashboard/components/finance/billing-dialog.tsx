"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Modal } from "@/components/ui";
import { CloseBillForm } from "@/components/work-orders/close-bill-form";
import { Spinner } from "./form-bits";

/**
 * "Edit billing" for a work-order line on a draft (spec 6.3): the shared WP3 CloseBillForm in
 * "edit" mode (workOrderBilling.updateBilling). The billing block is read from workOrders.get so
 * every stored field (including the internal cost) is sent back unchanged unless edited.
 */
export function BillingDialog({
  workOrderId,
  woLabel,
  onClose,
}: {
  workOrderId: string;
  woLabel: string;
  onClose: () => void;
}) {
  const detail = useQuery(api.workOrders.get, { workOrderId: workOrderId as Id<"workOrders"> });
  return (
    <Modal title={`Edit billing: ${woLabel}`} onClose={onClose} size="lg">
      {detail === undefined ? (
        <Spinner label="Loading work order…" />
      ) : detail === null || !detail.billing ? (
        <p className="text-[13.5px] text-muted-foreground">This work order can&apos;t be opened.</p>
      ) : !detail.billing.canEdit ? (
        <p className="text-[13.5px] text-muted-foreground">
          {detail.billing.billedLabel ?? "This work order's billing can't be changed here."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <CloseBillForm
            mode="edit"
            workOrderId={workOrderId as Id<"workOrders">}
            woNumber={detail.workOrder.number}
            billing={detail.billing}
            onDone={onClose}
            onCancel={onClose}
          />
        </div>
      )}
    </Modal>
  );
}
