"use client";

import type { ReactNode } from "react";
import { Btn } from "./controls";
import { Modal } from "./modal";

/** Replacement for window.confirm / alert. Omit `onConfirm` for an info-only alert (single OK button). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        onConfirm ? (
          <>
            <Btn onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Btn>
            <Btn variant={danger ? "dng" : "pri"} onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </Btn>
          </>
        ) : (
          <Btn variant="pri" onClick={onCancel}>
            OK
          </Btn>
        )
      }
    >
      {message ? <div className="text-[13.5px] text-muted-foreground">{message}</div> : null}
    </Modal>
  );
}
