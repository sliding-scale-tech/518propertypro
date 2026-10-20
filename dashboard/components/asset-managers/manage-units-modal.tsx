"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Btn, Input, Modal, Select, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import { LabelValue, UnderlineTabs, fmtStamp } from "./shared";

export type AssignedUnit = {
  unitId: Id<"units">;
  propertyName: string;
  unitNumber: string;
  label: string;
};

type Tab = "reassign" | "assign";
type ReassignResult = { kind: "reassign"; data: FunctionReturnType<typeof api.assetManagers.reassignUnit> };
type AssignResult = { kind: "assign"; data: FunctionReturnType<typeof api.assetManagers.assignUnitToManager> };

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

function joinList(items: string[]): string {
  return items.join(", ");
}

function InfoBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3.5 py-3">
      <div className="text-[13px] font-semibold">{title}</div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{children}</p>
    </div>
  );
}

export function ManageUnitsModal({
  userId,
  managerName,
  portfolioCount,
  units,
  preselectUnitId,
  onClose,
}: {
  userId: Id<"users">;
  managerName: string;
  portfolioCount: number;
  units: AssignedUnit[];
  preselectUnitId?: Id<"units">;
  onClose: () => void;
}) {
  const reassign = useMutation(api.assetManagers.reassignUnit);
  const assign = useMutation(api.assetManagers.assignUnitToManager);
  const overview = useQuery(api.assetManagers.overview, { pageSize: 100 });
  const others = useQuery(api.assetManagers.otherUnits, { userId });

  const [tab, setTab] = useState<Tab>(units.length === 0 ? "assign" : "reassign");
  const [unitId, setUnitId] = useState<string>(preselectUnitId ?? units[0]?.unitId ?? "");
  const [newManager, setNewManager] = useState("");
  const [reason, setReason] = useState("");
  const [pickedUnit, setPickedUnit] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReassignResult | AssignResult | null>(null);

  const managers = (overview?.rows ?? []).filter((r) => r.userId !== userId);
  const reasonOk = reason.trim().length >= 3;
  const canReassign = Boolean(unitId) && Boolean(newManager) && reasonOk && !busy;
  const assignReasonOk = assignReason.trim() === "" || assignReason.trim().length >= 3;
  const canAssign = Boolean(pickedUnit) && assignReasonOk && !busy;

  async function doReassign() {
    if (!canReassign) return;
    setBusy(true);
    try {
      const data = await reassign({ unitId: unitId as Id<"units">, newManagerUserId: newManager as Id<"users">, reason: reason.trim() });
      toast.success("Assignment updated");
      setResult({ kind: "reassign", data });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function doAssign() {
    if (!canAssign) return;
    setBusy(true);
    try {
      const data = await assign({
        unitId: pickedUnit as Id<"units">,
        managerUserId: userId,
        reason: assignReason.trim() || undefined,
      });
      toast.success("Unit assigned");
      setResult({ kind: "assign", data });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (result?.kind === "reassign") {
    const d = result.data;
    const newFirst = first(d.newManager.name);
    const prevFirst = first(d.previousManager.name);
    const moved = d.requestsMoved.map((r) => r.number);
    const wos = d.workOrdersUnchanged.map((w) => w.number);
    const handoff = [
      moved.length > 0
        ? `${joinList(moved)} ${moved.length === 1 ? "is" : "are"} now awaiting ${newFirst}'s review. Existing notes and review actions are preserved.`
        : "No open requests were affected.",
      wos.length > 0 ? `${joinList(wos)} ${wos.length === 1 ? "is" : "are"} unchanged.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <Modal title="Assignment Updated" onClose={onClose} size="md" footer={<Btn variant="pri" className="h-11 px-10" onClick={onClose}>Done</Btn>}>
        <div className="space-y-4">
          <div className="rounded-xl bg-success-soft px-3.5 py-3 text-success-ink">
            <div className="text-[13.5px] font-semibold">{d.newManager.name} is now designated</div>
            <div className="mt-0.5 text-[13px]">{fmtStamp(d.at)}</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <LabelValue label="Previous manager">{d.previousManager.name}</LabelValue>
            <LabelValue label="New manager">{d.newManager.name}</LabelValue>
          </div>
          <InfoBox title="Handoff completed">{handoff}</InfoBox>
          <InfoBox title="Portfolio updated">
            Unit {d.unit.unitNumber} no longer appears in {prevFirst}&apos;s assigned units. {prevFirst} now has {d.previousPortfolioCount} designated unit
            {d.previousPortfolioCount === 1 ? "" : "s"}.
          </InfoBox>
        </div>
      </Modal>
    );
  }

  if (result?.kind === "assign") {
    const d = result.data;
    return (
      <Modal title="Unit Assigned" onClose={onClose} size="md" footer={<Btn variant="pri" className="h-11 px-10" onClick={onClose}>Done</Btn>}>
        <div className="space-y-4">
          <div className="rounded-xl bg-success-soft px-3.5 py-3 text-success-ink">
            <div className="text-[13.5px] font-semibold">
              {d.designatedManager.name} is now designated to {d.unit.label}
            </div>
            <div className="mt-0.5 text-[13px]">{fmtStamp(d.at)}</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <LabelValue label="Designated manager">{d.designatedManager.name}</LabelValue>
            <LabelValue label="Portfolio total">
              {d.portfolioTotal} assigned unit{d.portfolioTotal === 1 ? "" : "s"}
            </LabelValue>
          </div>
          {d.requestsMoved.length > 0 || d.workOrdersUnchanged.length > 0 ? (
            <InfoBox title="Handoff completed">
              {d.requestsMoved.length > 0
                ? `${joinList(d.requestsMoved.map((r) => r.number))} now ${d.requestsMoved.length === 1 ? "awaits" : "await"} ${first(d.designatedManager.name)}'s review.`
                : "No open requests were affected."}
              {d.workOrdersUnchanged.length > 0 ? ` ${joinList(d.workOrdersUnchanged.map((w) => w.number))} unchanged.` : ""}
            </InfoBox>
          ) : null}
          <InfoBox title="Previous manager">
            {d.previousManager.name} now has {d.previousPortfolioCount} designated unit{d.previousPortfolioCount === 1 ? "" : "s"}.
          </InfoBox>
        </div>
      </Modal>
    );
  }

  const isAssign = tab === "assign";
  return (
    <Modal
      title={isAssign ? "Assign Another Unit" : "Manage Unit Assignments"}
      onClose={() => (busy ? undefined : onClose())}
      size="md"
      footer={
        <>
          <Btn onClick={onClose} disabled={busy} className="h-11 px-8">
            Cancel
          </Btn>
          {isAssign ? (
            <Btn variant="pri" onClick={() => void doAssign()} disabled={!canAssign} className="h-11">
              {busy ? "Assigning…" : "Confirm unit assignment"}
            </Btn>
          ) : (
            <Btn variant="pri" onClick={() => void doReassign()} disabled={!canReassign} className="h-11">
              {busy ? "Saving…" : "Confirm Reassignment"}
            </Btn>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {isAssign ? <p className="-mt-1 text-[13px] text-muted-foreground">Add a designated unit to {managerName}&apos;s portfolio</p> : null}
        <UnderlineTabs
          label="Unit assignment actions"
          value={tab}
          onChange={setTab}
          options={[
            { value: "reassign", label: "Reassign a unit" },
            { value: "assign", label: "Assign another unit" },
          ]}
        />

        {!isAssign ? (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-2 gap-4">
              <LabelValue label="Current manager">{managerName}</LabelValue>
              <LabelValue label="Assigned portfolio">
                {portfolioCount} unit{portfolioCount === 1 ? "" : "s"}
              </LabelValue>
            </div>
            {units.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border-strong px-3.5 py-3 text-[13px] text-muted-foreground">
                {managerName} has no units to reassign. Use &quot;Assign another unit&quot; to add one.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label id="am-unit-label" className="text-xs text-muted-foreground">Unit to reassign</label>
                  <Select aria-labelledby="am-unit-label" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                    {units.map((u) => (
                      <option key={u.unitId} value={u.unitId}>
                        {u.propertyName} · Unit {u.unitNumber}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label id="am-newmgr-label" className="text-xs text-muted-foreground">Select new manager</label>
                  <Select aria-labelledby="am-newmgr-label" value={newManager} placeholder="Choose an asset manager" onChange={(e) => setNewManager(e.target.value)}>
                    <option value="" disabled>
                      Choose an asset manager
                    </option>
                    {managers.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="am-reason" className="text-xs text-muted-foreground">Reason for reassignment</label>
                  <Input id="am-reason" value={reason} maxLength={500} placeholder={`e.g., Approved portfolio handover`} onChange={(e) => setReason(e.target.value)} className="h-11" />
                  {reason.length > 0 && !reasonOk ? <p className="text-xs text-danger-ink">Add at least 3 characters.</p> : null}
                </div>
                <div className="rounded-xl bg-accent px-3.5 py-3 text-primary">
                  <div className="text-[13px] font-semibold">A unit must keep one designated manager</div>
                  <p className="mt-0.5 text-[13px]">Choose a replacement; removing an active unit&apos;s manager without a replacement is unavailable.</p>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <div className="text-xs text-muted-foreground">Units managed by others</div>
            {others === undefined ? (
              <p className="text-[13px] text-muted-foreground">Loading…</p>
            ) : others.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border-strong px-3.5 py-3 text-[13px] text-muted-foreground">
                Every unit is already managed by {managerName}.
              </p>
            ) : (
              <div role="radiogroup" aria-label="Units managed by others" className="space-y-4">
                {others.map((g) => (
                  <div key={g.propertyId}>
                    <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-faint">{g.propertyName}</div>
                    <div className="space-y-2">
                      {g.units.map((u) => {
                        const on = pickedUnit === u.unitId;
                        return (
                          <button
                            key={u.unitId}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setPickedUnit(u.unitId)}
                            className={cx(
                              "flex w-full flex-col rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                              on ? "border-primary bg-accent text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted",
                            )}
                          >
                            <span className="text-[14px] font-medium">
                              {u.propertyName} · {u.unitNumber}
                            </span>
                            <span className="text-xs opacity-80">Currently {u.currentManager.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="am-assign-reason" className="text-xs text-muted-foreground">Reason (optional)</label>
              <Input id="am-assign-reason" value={assignReason} maxLength={500} onChange={(e) => setAssignReason(e.target.value)} className="h-11" />
              {!assignReasonOk ? <p className="text-xs text-danger-ink">Add at least 3 characters, or leave it empty.</p> : null}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
