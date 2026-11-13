"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { ownerRoutingStatus, type SarahConfig } from "@/convex/sarahConfigLib";
import { btnPrimary } from "@/components/maintenance/shared";
import { PhoneLine } from "@/components/sarah/phone-line";
import { SarahPushStatus } from "@/components/sarah/push-status";
import { RoutingEditor, fromRoutingDraft, routingDraftProblems, toRoutingDraft } from "@/components/sarah/routing-editor";
import { errorMessage, useToast } from "@/components/toast";
import { Card, CardHead } from "@/components/ui";

/**
 * Team page, "Phone & routing" tab (admins only; every query and mutation re-checks on the server).
 *
 * - Phone line saves immediately and is separate from Sarah's Save.
 * - Routing directory is part of Sarah's config. Save (B43) is the same save as on the Sarah config page:
 *   an admin's save goes live for new calls and updates Sarah automatically; the status line under it
 *   shows the push ("Saved. Sarah updated", or a Retry when it could not be updated yet).
 */
export function PhoneRoutingTab() {
  const data = useQuery(api.sarahConfig.get);
  const saveDraft = useMutation(api.sarahConfig.saveDraft);
  const toast = useToast();

  // null = no local edits: the editor shows the server's draft directly.
  const [edits, setEdits] = useState<SarahConfig["routingDirectory"] | null>(null);
  const [busy, setBusy] = useState<"save" | null>(null);

  const serverDir = data?.draft.routingDirectory ?? null;
  const unsaved = edits !== null && serverDir !== null && JSON.stringify(edits) !== JSON.stringify(serverDir);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const dir = edits ?? serverDir;

  const onSave = async () => {
    if (!data || !edits) return;
    const problem = routingDraftProblems(toRoutingDraft(edits), data.ownLine)[0];
    if (problem) {
      toast(problem.message, "error");
      return;
    }
    setBusy("save");
    try {
      // JSON round-trip drops undefined fields, which Convex arguments do not accept.
      const clean: SarahConfig = JSON.parse(JSON.stringify({ ...data.draft, routingDirectory: edits }));
      await saveDraft({ config: clean });
      setEdits(null);
      toast("Saved. Sarah updates for new calls in a few seconds.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Saves immediately and is separate from Sarah's Save. */}
      <PhoneLine />

      {data === undefined || dir === null ? (
        <Card>
          <p className="py-6 text-center text-sm text-muted-foreground">Loading routing directory…</p>
        </Card>
      ) : (
        <Card className="space-y-3">
          <CardHead
            title="Routing directory"
            hint="The owner call routing menu: who an existing property owner can be put through to, by name, role or keypad key. Sarah never gives these numbers out."
          />
          <p className="rounded-xl bg-muted px-3 py-2 text-[13px]">
            Saving here updates Sarah for new calls within a few seconds. A call already in progress keeps its setup.
            {!data.canEdit ? " You can view this but not change it." : ""}
          </p>
          {(() => {
            const st = ownerRoutingStatus({ ...data.draft, routingDirectory: dir });
            return (
              <p className={`rounded-xl px-3 py-2 text-[13px] ${st.live ? "bg-success-soft text-success-ink" : "bg-muted"}`}>
                <span className="font-medium">{st.live ? "Menu on." : "Menu off."}</span> {st.reason}
              </p>
            );
          })()}
          {/* Disabled for anyone who cannot edit: the server rejects their writes anyway. */}
          <fieldset disabled={!data.canEdit || busy === "save"} className="space-y-4 border-0 p-0">
            <RoutingEditor
              value={toRoutingDraft(dir)}
              onChange={(d) => setEdits(fromRoutingDraft(d))}
              readOnly={!data.canEdit}
              members={data.members}
              ownLine={data.ownLine}
              ownerEmailProperties={data.ownerEmailProperties}
              showEnable
            />
          </fieldset>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="mr-auto text-sm text-muted-foreground">
              {unsaved ? "Unsaved changes" : <SarahPushStatus />}
            </span>
            <button
              className={btnPrimary}
              disabled={!data.canEdit || !unsaved || busy !== null}
              title={!data.canEdit ? "You do not have permission to change Sarah" : undefined}
              onClick={() => void onSave()}
            >
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
