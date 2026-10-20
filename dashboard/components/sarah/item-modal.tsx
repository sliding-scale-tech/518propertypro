"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { ITEM_STATUS_LABEL, type ItemStatus } from "@/convex/sarahConfigLib";
import { Btn, ConfirmDialog, Modal, Pill, Seg, type Tone } from "@/components/ui";
import { errorMessage, useToast } from "@/components/ui/toast";
import { ContentEditor, toPayload, validateContent, type Content, type Detail } from "./item-forms";

/**
 * The Sarah item modal: a proposed script or form, the approval action and the history. The server
 * enforces who may edit and approve (any admin-view user). For an admin, saving an edit approves it
 * in the same step; the history keeps who did what and when.
 */

const STATUS_TONE: Record<ItemStatus, Tone> = {
  needs_contact: "warn",
  draft: "warn",
  pending_approval: "acc",
  changes_requested: "bad",
  approved: "ok",
  complete: "ok",
  decided: "neutral",
};

export function StatusPill({ status }: { status: ItemStatus }) {
  return (
    <Pill tone={STATUS_TONE[status]} dot>
      {ITEM_STATUS_LABEL[status]}
    </Pill>
  );
}

const ACTION_TEXT: Record<string, string> = {
  created: "Draft created",
  edited: "Edited by",
  reset: "Reset to draft by",
  submitted: "Submitted for approval by",
  approved: "Approved by",
  changes_requested: "Changes requested by",
  rejected: "Rejected by",
  skipped: "Skipped (admins only) by",
  unskipped: "Skip removed by",
};

function when(ms: number) {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function History({ rows }: { rows: Detail["history"] }) {
  return (
    <ol className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="border-l-2 border-border pl-3">
          <div className="text-sm font-medium">
            {ACTION_TEXT[r.action] ?? r.action} {r.actor}
          </div>
          <div className="text-xs text-muted-foreground">{when(r.at)}</div>
          {r.note ? <p className="mt-1 whitespace-pre-wrap text-[13px]">{r.note}</p> : null}
        </li>
      ))}
      <li className="border-l-2 border-border pl-3">
        <div className="text-sm font-medium">Draft created (Simplr&apos;s proposed default)</div>
      </li>
    </ol>
  );
}

type Dialog = null | "reset" | { remove: number };

export function ItemModal({
  itemId,
  onClose,
  onGoToTab,
  onOpenItem,
}: {
  itemId: string;
  onClose: () => void;
  onGoToTab: (area: Detail["area"]) => void;
  onOpenItem: (id: string) => void;
}) {
  const detail = useQuery(api.sarahConfig.itemDetail, { itemId });
  const saveItem = useMutation(api.sarahConfig.saveItem);
  const submitItem = useMutation(api.sarahConfig.submitItem);
  const approveItem = useMutation(api.sarahConfig.approveItem);
  const resetItem = useMutation(api.sarahConfig.resetItem);
  const toast = useToast();

  const [tab, setTab] = useState<"main" | "history">("main");
  const [buf, setBuf] = useState<Content | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  if (detail === undefined) {
    return (
      <Modal title="Loading" onClose={onClose} size="lg">
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
        </div>
      </Modal>
    );
  }
  if (detail === null) {
    return (
      <Modal title="Item not found" onClose={onClose}>
        <p className="text-sm">This item no longer exists.</p>
      </Modal>
    );
  }

  const d = detail;
  const editing = buf !== null;
  const view: Content = buf ?? d.content;
  const status = d.status as ItemStatus;
  const isContact = !d.approval;

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    try {
      const msg = await fn();
      if (msg) toast(msg, "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const onSave = () => {
    if (!buf) return;
    const problem = validateContent(buf);
    if (problem) {
      toast(problem, "error");
      return;
    }
    void run(async () => {
      const r = await saveItem({ itemId, payload: toPayload(buf) });
      setBuf(null);
      if (!r.changed) return "No changes to save.";
      return isContact ? "Details saved." : d.canApprove ? "Saved and approved. Publish to make it live." : "Saved. The item is back to draft and needs approval again.";
    });
  };

  const resetLabel = isContact ? "Clear details" : "Reset to draft";
  const resetMessage =
    d.modal === "routing"
      ? "This puts the menu back to the six names with no numbers, clears the fallback and after-hours text, and turns the routing menu off. Its approval is removed."
      : isContact
        ? "This clears the details you added. Sarah will not use them."
        : d.modal === "severity"
          ? "This puts the severity definitions back to the proposed defaults, clears who is notified, and removes any approval. Emergency handling is turned off until it is approved again."
          : "This replaces the wording with Simplr's proposed draft, removes any approval and turns the item off until it is approved again.";

  const footer = (
    <div className="flex w-full flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        className="mr-auto text-xs text-muted-foreground underline"
        onClick={() => {
          onGoToTab(d.area);
          onClose();
        }}
      >
        Go to tab
      </button>
      {editing ? (
        <>
          <Btn onClick={() => setBuf(null)} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={onSave} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Btn>
        </>
      ) : (
        <>
          {d.resettable ? (
            <Btn variant="dng" onClick={() => setDialog("reset")} disabled={busy}>
              {resetLabel}
            </Btn>
          ) : null}
          <Btn onClick={() => setBuf(d.content)} disabled={busy}>
            Edit
          </Btn>
          {d.approval && !d.canApprove ? (
            <Btn
              onClick={() =>
                void run(async () => {
                  await submitItem({ itemId });
                  return "Submitted for approval.";
                })
              }
              disabled={busy || status === "pending_approval" || status === "approved"}
              title={status === "pending_approval" ? "Already waiting for approval" : undefined}
            >
              Submit for approval
            </Btn>
          ) : null}
          {d.canApprove && d.approval ? (
            <Btn
              variant="pri"
              onClick={() =>
                void run(async () => {
                  await approveItem({ itemId, fingerprint: d.fingerprint });
                  return "Approved. Publish to make it live.";
                })
              }
              disabled={busy || status === "approved" || !!d.approveBlocked}
              title={d.approveBlocked ?? undefined}
            >
              Approve
            </Btn>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <>
      <Modal
        open={dialog === null}
        size="lg"
        title={d.title}
        onClose={onClose}
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone="neutral">{d.chip}</Pill>
            <StatusPill status={status} />
            {d.lastEditedBy ? <span>Last edited by {d.lastEditedBy}</span> : null}
          </span>
        }
        footer={footer}
      >
        <div className="space-y-4">
          <Seg
            label="Item sections"
            value={tab}
            onChange={setTab}
            options={[
              { value: "main", label: d.modal === "text" ? "Script" : "Details" },
              { value: "history", label: `History (${d.history.length})` },
            ]}
          />

          {tab === "history" ? (
            <History rows={d.history} />
          ) : (
            <>
              {!d.canApprove && d.approval && status !== "approved" ? (
                <div className="rounded-xl bg-muted px-3 py-2 text-[13px]">
                  <span className="font-medium">Until an admin approves it: </span>
                  {d.fallback}
                </div>
              ) : null}

              {d.approval && !d.canApprove && status !== "approved" ? (
                <p className="text-xs text-muted-foreground">
                  Waiting for an admin to approve. You can edit it and submit it for approval.
                </p>
              ) : null}

              {isContact ? <p className="text-[12.5px] font-medium text-accent-foreground">Details needed</p> : null}
              {d.id === "am-fallback" || d.id === "pilot-flows" ? (
                <p className="text-xs text-muted-foreground">This is a team decision. Sarah does not speak it.</p>
              ) : null}

              <ContentEditor
                content={view}
                onChange={setBuf}
                readOnly={!editing}
                members={d.members}
                itemId={d.id}
                onOpenItem={onOpenItem}
                requestRemove={(i) => setDialog({ remove: i })}
              />
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={dialog === "reset"}
        title={`${resetLabel}?`}
        message={resetMessage}
        confirmLabel={resetLabel}
        danger
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          void run(async () => {
            const r = await resetItem({ itemId });
            setDialog(null);
            setBuf(null);
            return r.changed ? (isContact ? "Details cleared." : "Reset to the proposed draft.") : "Already at the proposed draft.";
          })
        }
      />

      <ConfirmDialog
        open={typeof dialog === "object" && dialog !== null}
        title="Delete this entry?"
        message={
          typeof dialog === "object" && dialog !== null && view.kind === "routing"
            ? `Remove ${view.entries[dialog.remove]?.label || "this entry"} from the routing menu? The keys after it move up. This is saved when you click Save.`
            : undefined
        }
        confirmLabel="Delete entry"
        danger
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (typeof dialog === "object" && dialog !== null && view.kind === "routing") {
            const idx = dialog.remove;
            setBuf({ ...view, entries: view.entries.filter((_, k) => k !== idx) });
          }
          setDialog(null);
        }}
      />
    </>
  );
}
