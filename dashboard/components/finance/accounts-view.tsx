"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Lock } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { normalizeNameKey } from "@/convex/rosFormat";
import { KIND_LABELS, MAX_ACCOUNT_NAME, validateAccountFieldsAll, type RowType } from "@/convex/rosPolicy";
import { Btn, Card, CardHead, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, Pill, Select, Toggle, type Column } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { serverError } from "@/lib/form-errors";
import { FinanceNav } from "./finance-nav";
import { Spinner, useFieldErrors } from "./form-bits";

type AccountRow = FunctionReturnType<typeof api.ledgerAccounts.list>["accounts"][number];

/** Types a person can add (Owner Draw is the one system owner-draw account). */
const ADDABLE: RowType[] = ["income", "expense", "owner_contribution", "other_addition", "other_subtraction"];

/** `/owner-statements/accounts`: the chart of accounts (spec 6.6). */
export function AccountsView() {
  const data = useQuery(api.ledgerAccounts.list, { includeInactive: true });
  const ensureDefaults = useMutation(api.ledgerAccounts.ensureDefaults);
  const setActive = useMutation(api.ledgerAccounts.setActive);
  const setFeeBase = useMutation(api.ledgerAccounts.setFeeBase);
  const remove = useMutation(api.ledgerAccounts.remove);

  const [renaming, setRenaming] = useState<AccountRow | null>(null);
  const [deleting, setDeleting] = useState<AccountRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // First visit on a team: create the default accounts once.
  const seeded = useRef(false);
  useEffect(() => {
    if (!data?.needsSetup || seeded.current) return;
    seeded.current = true;
    ensureDefaults({}).catch((e) => toast.error(serverError(e).message));
  }, [data?.needsSetup, ensureDefaults]);

  async function act(id: string, run: () => Promise<unknown>, done: string) {
    setBusyId(id);
    try {
      await run();
      toast.success(done);
      return true;
    } catch (e) {
      toast.error(serverError(e).message);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const accounts = data?.accounts ?? [];
  const columns: Column<AccountRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (a) => (
        <span className="inline-flex items-center gap-1.5 font-medium">
          {a.name}
          {a.systemKey ? (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground" title="System account">
              <Lock aria-hidden className="h-3 w-3" /> System account
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "type", header: "Type", render: (a) => a.kindLabel },
    {
      key: "fee",
      header: "Counts toward management fee",
      render: (a) => (
        <Toggle
          checked={a.feeBase}
          label={`${a.name} counts toward the management fee`}
          disabled={a.kind !== "income" || busyId === a._id}
          onChange={(v) =>
            void act(
              a._id,
              () => setFeeBase({ accountId: a._id, feeBase: v }),
              v ? `${a.name} now counts toward the fee.` : `${a.name} no longer counts toward the fee.`,
            )
          }
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (a) => (a.active ? <Pill tone="ok">Active</Pill> : <Pill>Off</Pill>),
    },
    { key: "used", header: "Used", align: "right", className: "tabular-nums", render: (a) => a.usedLabel },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (a) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Btn sm disabled={!!a.systemKey || busyId === a._id} title={a.systemKey ? "System accounts can't be renamed." : undefined} onClick={() => setRenaming(a)}>
            Rename
          </Btn>
          <Btn
            sm
            disabled={(!!a.systemKey && a.active) || busyId === a._id}
            title={a.systemKey && a.active ? "System accounts can't be turned off." : undefined}
            onClick={() =>
              void act(
                a._id,
                () => setActive({ accountId: a._id, active: !a.active }),
                a.active ? `${a.name} turned off.` : `${a.name} turned on.`,
              )
            }
          >
            {a.active ? "Turn off" : "Turn on"}
          </Btn>
          <Btn
            sm
            variant="dng"
            disabled={!!a.systemKey || busyId === a._id}
            title={a.systemKey ? "System accounts can't be deleted." : undefined}
            onClick={() => setDeleting(a)}
          >
            Delete
          </Btn>
        </div>
      ),
    },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Accounts"
        subtitle="The accounts transactions are filed under. The type decides which side of the statement a row lands on."
      />
      <FinanceNav active="accounts" />
      <div className="flex flex-col gap-5">
        <Card>
          {data === undefined ? (
            <Spinner label="Loading accounts…" />
          ) : data.needsSetup && accounts.length === 0 ? (
            <Spinner label="Setting up the default accounts…" />
          ) : (
            <DataTable caption="Accounts" columns={columns} rows={accounts} rowKey={(a) => a._id} empty="No accounts yet." />
          )}
        </Card>
        <AddAccountCard accounts={accounts} />
      </div>
      {renaming ? <RenameDialog account={renaming} accounts={accounts} onClose={() => setRenaming(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `Delete ${deleting.name}?` : ""}
        message="Only an account no transaction or work order uses can be deleted. Turn it off instead to keep its history."
        confirmLabel="Delete"
        danger
        busy={deleting !== null && busyId === deleting._id}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const a = deleting;
          void act(a._id, () => remove({ accountId: a._id }), `${a.name} deleted.`).then(() => setDeleting(null));
        }}
      />
    </div>
  );
}

function AddAccountCard({ accounts }: { accounts: AccountRow[] }) {
  const create = useMutation(api.ledgerAccounts.create);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ name: `${base}-name`, kind: `${base}-kind` }), [base]);
  const f = useFieldErrors(ids);

  async function submit() {
    if (busy) return;
    const key = normalizeNameKey(name);
    const nameTaken = key !== "" && accounts.some((a) => normalizeNameKey(a.name) === key);
    if (!f.check(validateAccountFieldsAll({ mode: "create", name, kind: kind || null, nameTaken }), ["name", "kind"])) return;
    setBusy(true);
    try {
      await create({ name: name.trim(), kind });
      toast.success(`${name.trim()} added.`);
      setName("");
      setKind("");
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead title="Add account" />
      <div className="grid gap-4 sm:grid-cols-[1fr_240px_auto] sm:items-start">
        <Field label="Name *" htmlFor={ids.name}>
          <Input
            id={ids.name}
            value={name}
            maxLength={MAX_ACCOUNT_NAME + 20}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
              f.clear("name");
            }}
            {...f.control("name")}
          />
          {f.message("name")}
        </Field>
        <Field label="Type *" htmlFor={ids.kind}>
          <Select
            id={ids.kind}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value || "");
              f.clear("kind");
            }}
            aria-describedby={f.control("kind")["aria-describedby"]}
            className={f.control("kind").className}
          >
            <option value="">Select a type</option>
            {ADDABLE.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          {f.message("kind")}
        </Field>
        <div className="sm:pt-[22px]">
          <Btn variant="pri" onClick={() => void submit()} disabled={busy}>
            {busy ? "Adding…" : "Add account"}
          </Btn>
        </div>
      </div>
    </Card>
  );
}

function RenameDialog({ account, accounts, onClose }: { account: AccountRow; accounts: AccountRow[]; onClose: () => void }) {
  const rename = useMutation(api.ledgerAccounts.rename);
  const [name, setName] = useState(account.name);
  const [busy, setBusy] = useState(false);
  const base = useId();
  const ids = useMemo(() => ({ name: `${base}-name` }), [base]);
  const f = useFieldErrors(ids);

  async function submit() {
    if (busy) return;
    const key = normalizeNameKey(name);
    const nameTaken = key !== "" && accounts.some((a) => a._id !== account._id && normalizeNameKey(a.name) === key);
    if (!f.check(validateAccountFieldsAll({ mode: "rename", name, nameTaken }), ["name"])) return;
    setBusy(true);
    try {
      await rename({ accountId: account._id, name: name.trim() });
      toast.success("Account renamed.");
      onClose();
    } catch (e) {
      f.fromServer(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Rename ${account.name}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="pri" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <Field label="Name *" htmlFor={ids.name} hint="Past statements keep the name they were finalized with.">
        <Input
          id={ids.name}
          value={name}
          maxLength={MAX_ACCOUNT_NAME + 20}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            f.clear("name");
          }}
          {...f.control("name")}
        />
        {f.message("name")}
      </Field>
    </Modal>
  );
}
