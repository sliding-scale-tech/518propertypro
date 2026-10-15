"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/toast";
import { Dropdown } from "@/components/ui/dropdown";
import {
  Field,
  Modal,
  SEVERITY_OPTIONS,
  UnitPicker,
  btnOutline,
  btnPrimary,
  cleanError,
  inputClass,
  type Severity,
} from "./shared";

export function NewRequestModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (id: Id<"maintenanceRequests">) => void;
}) {
  const toast = useToast();
  const create = useMutation(api.maintenance.createManual);
  const [unitId, setUnitId] = useState<Id<"units"> | "">("");
  const [issueType, setIssueType] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("routine");
  const [callerName, setCallerName] = useState("");
  const [callback, setCallback] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = unitId !== "" && issueType.trim() !== "" && description.trim() !== "";

  return (
    <Modal title="New request" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || busy || unitId === "") return;
          setBusy(true);
          try {
            const id = await create({
              unitId,
              issueType: issueType.trim(),
              description: description.trim(),
              severity,
              callerName: callerName.trim() || undefined,
              callbackNumber: callback.trim() || undefined,
            });
            toast("Request created.", "success");
            onCreated?.(id);
            onClose();
          } catch (err) {
            toast(cleanError(err), "error");
            setBusy(false);
          }
        }}
      >
        <Field label="Unit">
          <UnitPicker value={unitId} onChange={setUnitId} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Issue type" hint="e.g. plumbing, heating, electrical">
            <input className={inputClass} value={issueType} maxLength={40} onChange={(e) => setIssueType(e.target.value)} />
          </Field>
          <Field label="Severity">
            <Dropdown value={severity} options={SEVERITY_OPTIONS} onChange={setSeverity} />
          </Field>
        </div>
        <Field label="Description">
          <textarea className={`${inputClass} min-h-24`} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Caller name (optional)">
            <input className={inputClass} value={callerName} maxLength={120} onChange={(e) => setCallerName(e.target.value)} />
          </Field>
          <Field label="Callback number (optional)">
            <input className={inputClass} value={callback} maxLength={40} inputMode="tel" onChange={(e) => setCallback(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnOutline} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={!valid || busy}>
            {busy ? "Creating…" : "Create request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
