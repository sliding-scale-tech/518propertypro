"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/components/tech/lib";
import { useToast } from "@/components/toast";
import { Btn, Drawer, Field, Select, Textarea } from "@/components/ui";
import { ISSUE_TYPES, SEVERITY_CHOICES, issueLabel, mrId, type Severity } from "./shared";

/**
 * Manual entry (A8). Calls maintenance.createManual with autoForward. Executive/admin/Pat may enter
 * for any unit; an asset manager only for units they manage, and the server always sends an AM's
 * request to Pat's review (Waiting on Pat), never to a technician. The server enforces all of it.
 */
export function NewWorkOrderDrawer({
  open,
  onClose,
  leadName,
}: {
  open: boolean;
  onClose: () => void;
  leadName: string;
}) {
  const toast = useToast();
  const create = useMutation(api.maintenance.createManual);
  const access = useQuery(api.team.myAccess);
  const properties = useQuery(api.properties.list);
  const units = useQuery(api.units.list, open ? {} : "skip");

  const [propertyId, setPropertyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<string>("other");
  const [severity, setSeverity] = useState<Severity>("routine");
  const [score, setScore] = useState(""); // optional 1-10, "" = none
  const [residentId, setResidentId] = useState("");
  const [busy, setBusy] = useState(false);

  const isAdmin = access?.view === "admin";
  // The server re-checks ownership; this only keeps the pickers to units the viewer can use.
  const usable = useMemo(() => (units ?? []).filter((u) => isAdmin || (u.isMine && u.covering !== true)), [units, isAdmin]);
  const propertyOptions = useMemo(() => {
    const ids = new Set(usable.map((u) => u.propertyId as string));
    return (properties ?? []).filter((p) => ids.has(p._id));
  }, [properties, usable]);
  const unitOptions = usable.filter((u) => u.propertyId === propertyId);
  const residents = useQuery(api.residents.list, open && unitId ? { unitId: unitId as Id<"units"> } : "skip");

  const reset = () => {
    setPropertyId("");
    setUnitId("");
    setDescription("");
    setIssueType("other");
    setSeverity("routine");
    setScore("");
    setResidentId("");
  };

  const submit = async () => {
    setBusy(true);
    try {
      const resident = (residents ?? []).find((r) => r._id === residentId);
      const res = await create({
        unitId: unitId as Id<"units">,
        issueType,
        description: description.trim(),
        severity,
        severityScore: score ? Number(score) : undefined,
        residentId: resident ? resident._id : undefined,
        callerName: resident?.fullName,
        autoForward: true,
      });
      toast(`${mrId(res.number)} created. It is waiting on ${leadName}.`);
      reset();
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} eyebrow="Manual entry" title="New work order">
      <p className="text-[13px] text-muted-foreground">
        {isAdmin ? "For issues reported in person or spotted on a walkthrough." : "For issues reported in person or on a walkthrough."}{" "}
        {isAdmin
          ? `It skips asset-manager review and lands in ${leadName}'s queue.`
          : `It goes to ${leadName} for review.`}
      </p>
      <Field label="Property" htmlFor="nwo-property">
        <Select
          id="nwo-property"
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setUnitId("");
            setResidentId("");
          }}
        >
          <option value="">Select a property…</option>
          {propertyOptions.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Unit" htmlFor="nwo-unit">
        <Select
          id="nwo-unit"
          value={unitId}
          disabled={!propertyId}
          onChange={(e) => {
            setUnitId(e.target.value);
            setResidentId("");
          }}
        >
          <option value="">Select a unit…</option>
          {unitOptions.map((u) => (
            <option key={u._id} value={u._id}>
              {u.unitNumber}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="What needs fixing" htmlFor="nwo-desc">
        <Textarea
          id="nwo-desc"
          value={description}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Hallway light fixture flickering"
        />
      </Field>
      <div className="grid grid-cols-1 gap-2.5 min-[520px]:grid-cols-2">
        <Field label="Category" htmlFor="nwo-cat">
          <Select id="nwo-cat" value={issueType} onChange={(e) => setIssueType(e.target.value)}>
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {issueLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Severity" htmlFor="nwo-sev">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Select id="nwo-sev" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              {SEVERITY_CHOICES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Select aria-label="Severity score (optional)" value={score} onChange={(e) => setScore(e.target.value)}>
              <option value="">No score</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}/10
                </option>
              ))}
            </Select>
          </div>
        </Field>
      </div>
      <Field label="Tenant (optional)" htmlFor="nwo-tenant">
        <Select
          id="nwo-tenant"
          value={residentId}
          disabled={!unitId || (residents ?? []).length === 0}
          onChange={(e) => setResidentId(e.target.value)}
        >
          <option value="">{unitId && (residents ?? []).length === 0 ? "No residents on file" : "Not specified"}</option>
          {(residents ?? []).map((r) => (
            <option key={r._id} value={r._id}>
              {r.fullName}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <Btn variant="pri" disabled={busy || !unitId || !description.trim()} onClick={submit}>
          ＋ Create
        </Btn>
      </div>
    </Drawer>
  );
}
