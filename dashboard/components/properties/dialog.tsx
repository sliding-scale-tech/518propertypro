"use client";

import type { ReactNode } from "react";
import { Modal } from "@/components/ui";

/** Centered modal dialog for forms and confirmations (thin wrapper over the shared ui Modal). */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {children}
    </Modal>
  );
}
