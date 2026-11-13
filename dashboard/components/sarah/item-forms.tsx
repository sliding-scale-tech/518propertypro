"use client";

import type { FunctionReturnType } from "convex/server";
import { Plus, Trash2 } from "lucide-react";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isValidPhone, UTILITY_PLACEHOLDER } from "@/convex/sarahConfigLib";
import { routingProblems } from "@/convex/ownerRoutingLib";
import { Btn, Field, IconBtn, Input, Textarea, cx } from "@/components/ui";
import { FieldError, HoursEditor, PhoneField, RoutingEditor, routingDraftProblems, type RoutingDraft } from "./routing-editor";

/** The editors for each kind of "Needs approval" item. Pure form UI: the modal owns saving. */

export type Detail = NonNullable<FunctionReturnType<typeof api.sarahConfig.itemDetail>>;
export type Content = Detail["content"];
export type Member = Detail["members"][number];

const LEVEL_LABEL = { emergency: "Emergency", urgent: "Urgent", routine: "Routine", informational: "Informational" } as const;
const NOTIFIED_LEVELS = ["emergency", "urgent"];

// --- Validation (mirrors the server; the server is the boundary) -----------------------------------

export function validateContent(c: Content): string | null {
  if (c.kind === "text") {
    if (!c.wording.trim()) return "Write the wording first.";
    if (c.wording.length > 2000) return "Wording can be at most 2000 characters.";
    if (c.phoneEditable && c.phone.trim() && !isValidPhone(c.phone)) return "Enter a valid phone number, like 518-365-0996, or 911.";
  } else if (c.kind === "gas") {
    const bad = c.properties.find((p) => p.phone.trim() && !isValidPhone(p.phone.trim()));
    if (bad) return `The number for ${bad.name} is not a valid phone number. Use digits and +, like +15185550100.`;
  } else if (c.kind === "delia") {
    const p = deliaProblems(c)[0];
    if (p) return p.message;
  } else if (c.kind === "escalation") {
    const bad = c.externalPhones.find((p) => p.trim() && (!isValidPhone(p) || p.trim() === "911"));
    if (bad) return `"${bad}" is not a valid phone number.`;
  } else if (c.kind === "routing") {
    const p = routingDraftProblems(routingDraftOf(c), c.ownLine)[0];
    if (p) return p.message;
  } else {
    if (c.levels.some((l) => !l.definition.trim())) return "Every severity level needs a definition.";
    const bad = c.escalation.flatMap((e) => e.externalPhones).find((p) => p.trim() && (!isValidPhone(p) || p.trim() === "911"));
    if (bad) return `"${bad}" is not a valid phone number.`;
  }
  return null;
}

type DeliaContent = Extract<Content, { kind: "delia" }>;
type RoutingContent = Extract<Content, { kind: "routing" }>;

/** Delia's one entry, checked with the same rules as the routing directory. */
function deliaProblems(c: DeliaContent) {
  return routingProblems(
    { enabled: false, entries: [{ label: c.name.trim() || "Delia (Accounting)", phone: c.phone, extension: c.extension, hours: c.hours }] },
    { ownLines: c.ownLine ? [c.ownLine] : [] },
  );
}

function routingDraftOf(c: RoutingContent): RoutingDraft {
  return { enabled: c.enabled, entries: c.entries, fallback: c.fallback, afterHours: c.afterHours, mainOfficeNumber: c.mainOfficeNumber };
}

/** The server arguments for a save. */
export function toPayload(c: Content) {
  if (c.kind === "text") {
    return { kind: "text" as const, wording: c.wording, ...(c.phoneEditable ? { phone: c.phone } : {}) };
  }
  if (c.kind === "gas") {
    return { kind: "gas" as const, phones: c.properties.map((p) => ({ propertyId: p.id as Id<"properties">, phone: p.phone })) };
  }
  if (c.kind === "delia") return { kind: "delia" as const, name: c.name, phone: c.phone, hours: c.hours, extension: c.extension };
  if (c.kind === "escalation") {
    return { kind: "escalation" as const, level: c.level, userIds: c.userIds as Id<"users">[], externalPhones: c.externalPhones };
  }
  if (c.kind === "routing") {
    return {
      kind: "routing" as const,
      entries: c.entries.map((e) => ({
        label: e.label,
        phone: e.phone,
        hours: e.hours,
        extension: e.extension,
        // "" = nobody chosen (the team callback list); the server treats ""/null/absent alike.
        userId: e.userId ? (e.userId as Id<"users">) : ("" as const),
      })),
      fallback: c.fallback,
      afterHours: c.afterHours,
      mainOfficeNumber: c.mainOfficeNumber,
    };
  }
  return {
    kind: "severity" as const,
    levels: c.levels,
    escalation: c.escalation.map((e) => ({ level: e.level, userIds: e.userIds, externalPhones: e.externalPhones })),
  };
}

// --- Small pieces ----------------------------------------------------------------------------------

function PhoneInput({
  value,
  onChange,
  readOnly,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  label: string;
  placeholder?: string;
}) {
  const v = value.trim();
  const bad = v !== "" && !isValidPhone(v);
  return (
    <div className="min-w-0">
      <Input
        aria-label={label}
        aria-invalid={bad}
        inputMode="tel"
        autoComplete="off"
        maxLength={24}
        readOnly={readOnly}
        placeholder={placeholder ?? "+15185550100"}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d+()\-.\s]/g, ""))}
        className={cx(bad && "border-danger-ink")}
      />
      {bad ? <p className="mt-1 text-xs text-danger-ink">Use digits and +, like +15185550100.</p> : null}
    </div>
  );
}

function ExternalPhones({
  items,
  onChange,
  readOnly,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  readOnly: boolean;
}) {
  return (
    <div className="space-y-2">
      {items.map((p, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <div className="flex-1">
            <PhoneInput
              label={`Outside number ${i + 1}`}
              value={p}
              readOnly={readOnly}
              onChange={(v) => onChange(items.map((x, k) => (k === i ? v : x)))}
            />
          </div>
          {!readOnly ? (
            <IconBtn label="Remove number" onClick={() => onChange(items.filter((_, k) => k !== i))}>
              <Trash2 />
            </IconBtn>
          ) : null}
        </div>
      ))}
      {items.length === 0 && readOnly ? <p className="text-xs text-muted-foreground">None added.</p> : null}
      {!readOnly && items.length < 10 ? (
        <Btn sm onClick={() => onChange([...items, ""])}>
          <Plus className="h-3.5 w-3.5" /> Add number
        </Btn>
      ) : null}
    </div>
  );
}

function NotifyPicker({
  userIds,
  externalPhones,
  members,
  readOnly,
  onChange,
}: {
  userIds: string[];
  externalPhones: string[];
  members: Member[];
  readOnly: boolean;
  onChange: (next: { userIds: string[]; externalPhones: string[] }) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Team members texted at this level</div>
      <div className="flex flex-wrap gap-2">
        {members.map((m) => {
          const on = userIds.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={on}
              disabled={readOnly}
              onClick={() => onChange({ userIds: on ? userIds.filter((id) => id !== m.id) : [...userIds, m.id], externalPhones })}
              className={cx(
                "rounded-full border px-3 py-1 text-[12.5px] transition-colors disabled:cursor-default",
                on ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground",
                !readOnly && !on && "hover:bg-muted",
              )}
            >
              {m.name}
            </button>
          );
        })}
      </div>
      <div className="text-xs font-medium text-muted-foreground">Outside phone numbers</div>
      <ExternalPhones items={externalPhones} readOnly={readOnly} onChange={(p) => onChange({ userIds, externalPhones: p })} />
    </div>
  );
}

// --- Editors ---------------------------------------------------------------------------------------

export function ContentEditor({
  content,
  onChange,
  readOnly,
  members,
  requestRemove,
  onOpenItem,
  itemId,
}: {
  content: Content;
  onChange: (next: Content) => void;
  readOnly: boolean;
  members: Member[];
  /** Asks the modal to confirm removing routing entry `index`. */
  requestRemove: (index: number) => void;
  onOpenItem: (id: string) => void;
  itemId: string;
}) {
  const c = content;

  if (c.kind === "text") {
    return (
      <div className="space-y-3">
        <Field
          label={c.spoken ? "Words Sarah says" : "Proposal"}
          hint={
            <>
              {c.wording.length}/2000 characters.
              {c.wording.includes(UTILITY_PLACEHOLDER)
                ? " The utility number is filled in per property. Without one, Sarah just says to contact the gas utility provider."
                : ""}
            </>
          }
        >
          <Textarea
            rows={7}
            maxLength={2000}
            readOnly={readOnly}
            value={c.wording}
            onChange={(e) => onChange({ ...c, wording: e.target.value })}
          />
        </Field>
        {c.phoneEditable ? (
          <Field label="Phone number Sarah may give" hint="911 or a full number like 518-365-0996. Sarah gives no other number.">
            <div className="sm:w-64">
              <PhoneInput label="Phone number Sarah may give" value={c.phone} readOnly={readOnly} onChange={(phone) => onChange({ ...c, phone })} placeholder="911" />
            </div>
          </Field>
        ) : null}
        {itemId === "flow-vendor_payment" ? (
          <p className="text-xs text-muted-foreground">
            Delia&apos;s number is not part of this wording.{" "}
            <button type="button" className="underline" onClick={() => onOpenItem("delia-contact")}>
              Add Delia&apos;s contact details
            </button>
          </p>
        ) : null}
        {itemId === "script-gas_slight" ? (
          <p className="text-xs text-muted-foreground">
            The utility number is per property.{" "}
            <button type="button" className="underline" onClick={() => onOpenItem("utility-number")}>
              Add gas utility numbers
            </button>
          </p>
        ) : null}
      </div>
    );
  }

  if (c.kind === "gas") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          One number per property: the gas company&apos;s line for that building. Leave a property empty if you do not have it. Sarah
          never guesses a number. Numbers are saved on the property.
        </p>
        {c.properties.length === 0 ? <p className="text-sm">No properties yet. Add a property first.</p> : null}
        <div className="divide-y divide-border rounded-xl border border-border">
          {c.properties.map((p, i) => (
            <div key={p.id} className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_14rem]">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.name}</div>
                {p.phone.trim() === "" ? <div className="text-xs text-warning-ink">Needs contact details</div> : null}
              </div>
              <PhoneInput
                label={`Gas utility number for ${p.name}`}
                value={p.phone}
                readOnly={readOnly}
                onChange={(phone) => onChange({ ...c, properties: c.properties.map((x, k) => (k === i ? { ...x, phone } : x)) })}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (c.kind === "delia") {
    const err: Record<string, string> = {};
    for (const p of deliaProblems(c)) {
      const k = p.field.split(".").pop() ?? p.field;
      if (!err[k]) err[k] = p.message;
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Vendor payment questions go to Delia in accounting. Enter her direct number, and an extension if she has one. Sarah gives
          the number only for vendor payment questions. This is the same entry as Delia&apos;s line in the Routing directory.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_7rem]">
          <Field label="Name">
            <div>
              <Input
                maxLength={100}
                readOnly={readOnly}
                aria-invalid={!!err.label}
                value={c.name}
                onChange={(e) => onChange({ ...c, name: e.target.value })}
                className={cx(err.label && "border-danger-ink")}
              />
              <FieldError message={err.label} />
            </div>
          </Field>
          <Field label="Phone number">
            <PhoneField
              label="Delia phone number"
              placeholder="518-555-0123"
              value={c.phone}
              readOnly={readOnly}
              error={err.phone}
              onChange={(phone) => onChange({ ...c, phone })}
            />
          </Field>
          <Field label="Extension">
            <div>
              <Input
                aria-label="Delia extension"
                inputMode="numeric"
                maxLength={12}
                readOnly={readOnly}
                placeholder="Optional"
                aria-invalid={!!err.extension}
                value={c.extension}
                onChange={(e) => onChange({ ...c, extension: e.target.value.replace(/[^\d]/g, "") })}
                className={cx(err.extension && "border-danger-ink")}
              />
              <FieldError message={err.extension} />
            </div>
          </Field>
        </div>
        <Field label="Hours (New York time, optional)">
          <HoursEditor label="Delia's hours" value={c.hours} readOnly={readOnly} error={err.hours} onChange={(hours) => onChange({ ...c, hours })} />
        </Field>
      </div>
    );
  }

  if (c.kind === "escalation") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          These people are texted when a request is {LEVEL_LABEL[c.level]}, in addition to the assigned asset manager and the maintenance
          lead. Team members need a mobile number on their profile to get texts.
        </p>
        <NotifyPicker
          userIds={c.userIds}
          externalPhones={c.externalPhones}
          members={members}
          readOnly={readOnly}
          onChange={(n) => onChange({ ...c, ...n })}
        />
      </div>
    );
  }

  if (c.kind === "routing") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Phone menu options, in key order. Leave a number blank until Pat provides it: Sarah then says that person isn&apos;t
          available by phone and takes a message. The on/off switch is on the Team page, Phone & routing tab.
        </p>
        <RoutingEditor
          value={routingDraftOf(c)}
          onChange={(d) => onChange({ ...c, ...d })}
          readOnly={readOnly}
          members={members}
          ownLine={c.ownLine}
          onRemove={requestRemove}
        />
      </div>
    );
  }

  // severity
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sarah picks one of these four levels for every maintenance request. Definitions are pre-filled from the current rubric. Choose who is
        texted at each level.
      </p>
      {c.levels.map((l) => {
        const esc = c.escalation.find((e) => e.level === l.level);
        const updLevel = (patch: Partial<typeof l>) =>
          onChange({ ...c, levels: c.levels.map((x) => (x.level === l.level ? { ...x, ...patch } : x)) });
        return (
          <div key={l.level} className="space-y-2 rounded-xl border border-border p-3">
            <div className="text-sm font-semibold">{LEVEL_LABEL[l.level]}</div>
            <Field label="Definition">
              <Textarea rows={3} maxLength={2000} readOnly={readOnly} value={l.definition} onChange={(e) => updLevel({ definition: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Examples">
                <Input maxLength={2000} readOnly={readOnly} value={l.examples} onChange={(e) => updLevel({ examples: e.target.value })} />
              </Field>
              <Field label="Response target">
                <Input maxLength={200} readOnly={readOnly} value={l.responseTarget} onChange={(e) => updLevel({ responseTarget: e.target.value })} />
              </Field>
            </div>
            {NOTIFIED_LEVELS.includes(l.level) && esc ? (
              <NotifyPicker
                userIds={esc.userIds}
                externalPhones={esc.externalPhones}
                members={members}
                readOnly={readOnly}
                onChange={(n) =>
                  onChange({
                    ...c,
                    escalation: c.escalation.map((e) => (e.level === l.level ? { ...e, userIds: n.userIds as typeof e.userIds, externalPhones: n.externalPhones } : e)),
                  })
                }
              />
            ) : (
              <p className="text-xs text-muted-foreground">Not texted. It is logged for the assigned asset manager.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
