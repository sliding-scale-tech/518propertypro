"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DAY_NAMES,
  MAX_ROUTING_ENTRIES,
  describeHours,
  formatHours,
  parseHours,
  routingProblems,
  routingWarnings,
  type HoursRule,
  type RoutingProblem,
} from "@/convex/ownerRoutingLib";
import type { SarahConfig } from "@/convex/sarahConfigLib";
import { NO_PRESS_ZERO_WARNING } from "@/convex/sarahConfigLib";
import { Btn, Field, IconBtn, Input, Select, Textarea, Toggle, cx } from "@/components/ui";

/**
 * The owner call routing directory editor (Sarah Configuration section 13), shared by the Routing
 * directory tab and the "Routing menu" item modal. Pure form UI: the caller saves. Problems come from
 * ownerRoutingLib.routingProblems, the same function the server runs, so each field shows the message
 * the server would give.
 */

export type RoutingEntryDraft = { label: string; phone: string; extension: string; hours: string; userId: string };
export type RoutingDraft = {
  enabled: boolean;
  entries: RoutingEntryDraft[];
  fallback: string;
  afterHours: string;
  mainOfficeNumber: string;
};
export type RoutingMember = { id: string; name: string };

type Dir = SarahConfig["routingDirectory"];

/** The stored directory as editable strings ("" = unset, whether it was empty, null or missing). */
export function toRoutingDraft(r: Dir): RoutingDraft {
  return {
    enabled: r.enabled,
    entries: r.entries.map((e) => ({
      label: e.label,
      phone: e.phone,
      extension: e.extension ?? "",
      hours: e.hours ?? "",
      userId: e.userId ?? "",
    })),
    fallback: r.fallback ?? "",
    afterHours: r.afterHours ?? "",
    mainOfficeNumber: r.mainOfficeNumber ?? "",
  };
}

/** Back to the stored shape. Empty optional fields are left out. */
export function fromRoutingDraft(d: RoutingDraft): Dir {
  return {
    enabled: d.enabled,
    entries: d.entries.map((e) => ({
      label: e.label,
      phone: e.phone,
      ...(e.extension.trim() ? { extension: e.extension } : {}),
      ...(e.hours.trim() ? { hours: e.hours } : {}),
      ...(e.userId ? { userId: e.userId as Id<"users"> } : {}),
    })),
    ...(d.fallback.trim() ? { fallback: d.fallback } : {}),
    ...(d.afterHours.trim() ? { afterHours: d.afterHours } : {}),
    ...(d.mainOfficeNumber.trim() ? { mainOfficeNumber: d.mainOfficeNumber } : {}),
  };
}

/** Every problem, in field order. The first one is what a save toasts. */
export function routingDraftProblems(d: RoutingDraft, ownLine: string | null | undefined): RoutingProblem[] {
  return routingProblems(d, { ownLines: ownLine ? [ownLine] : [] });
}

function errorMap(problems: RoutingProblem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of problems) if (!out[p.field]) out[p.field] = p.message;
  return out;
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-danger-ink">{message}</p> : null;
}

const DEFAULT_RULE: HoursRule = { days: [0, 1, 2, 3, 4], start: "09:00", end: "17:00" };

/** Days and times, in New York time. Empty = any time. Writes the canonical string ("Mon-Fri 09:00-17:00"). */
export function HoursEditor({
  value,
  onChange,
  readOnly,
  label,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  label: string;
  error?: string;
}) {
  const parsed = parseHours(value);
  if (parsed === null) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-danger-ink">
          These hours were typed as free text and can&apos;t be read: &quot;{value.slice(0, 80)}&quot;. Set them again with the controls.
        </p>
        {!readOnly ? (
          <Btn sm onClick={() => onChange("")}>
            Clear and set hours
          </Btn>
        ) : null}
      </div>
    );
  }
  const rules = parsed;
  const set = (next: HoursRule[]) => onChange(formatHours(next));
  const upd = (i: number, patch: Partial<HoursRule>) => set(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">Any time: no hours set, so Sarah can put owners through at any hour.</p>
      ) : null}
      {rules.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border p-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label={`${label}: days for set ${i + 1}`}>
            {DAY_NAMES.map((d, di) => {
              const on = r.days.includes(di);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  disabled={readOnly}
                  // At least one day stays picked; remove the set to drop it.
                  onClick={() => {
                    if (on && r.days.length === 1) return;
                    upd(i, { days: on ? r.days.filter((x) => x !== di) : [...r.days, di].sort((a, b) => a - b) });
                  }}
                  className={cx(
                    "rounded-full border px-2 py-0.5 text-[12px] transition-colors disabled:cursor-default",
                    on ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <Input
            type="time"
            step={900}
            aria-label={`${label}: from (set ${i + 1})`}
            readOnly={readOnly}
            className="w-28"
            value={r.start}
            onChange={(e) => e.target.value && upd(i, { start: e.target.value })}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="time"
            step={900}
            aria-label={`${label}: until (set ${i + 1})`}
            readOnly={readOnly}
            className="w-28"
            value={r.end === "24:00" ? "00:00" : r.end}
            onChange={(e) => e.target.value && e.target.value !== r.start && upd(i, { end: e.target.value })}
          />
          {!readOnly ? (
            <IconBtn label={`Remove hours set ${i + 1}`} onClick={() => set(rules.filter((_, k) => k !== i))}>
              <Trash2 />
            </IconBtn>
          ) : null}
        </div>
      ))}
      {rules.length > 0 ? <p className="text-xs text-muted-foreground">{describeHours(rules)} (New York time).</p> : null}
      {!readOnly && rules.length < 14 ? (
        <Btn sm onClick={() => set([...rules, DEFAULT_RULE])}>
          <Plus className="h-3.5 w-3.5" /> {rules.length ? "Add more hours" : "Set hours"}
        </Btn>
      ) : null}
      <FieldError message={error} />
    </div>
  );
}

export function PhoneField({
  value,
  onChange,
  readOnly,
  label,
  placeholder,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  label: string;
  placeholder: string;
  error?: string;
}) {
  return (
    <div className="min-w-0">
      <Input
        aria-label={label}
        aria-invalid={!!error}
        inputMode="tel"
        autoComplete="off"
        maxLength={24}
        readOnly={readOnly}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d+()\-.\s]/g, ""))}
        className={cx(error && "border-danger-ink")}
      />
      <FieldError message={error} />
    </div>
  );
}

/** Who can be put through, and how the menu behaves. */
export function RoutingEditor({
  value,
  onChange,
  readOnly,
  members,
  ownLine,
  showEnable,
  onRemove,
  ownerEmailProperties,
}: {
  value: RoutingDraft;
  onChange: (next: RoutingDraft) => void;
  readOnly: boolean;
  members: RoutingMember[];
  ownLine: string | null | undefined;
  /** The page tab shows the on/off switch; the item modal does not. */
  showEnable?: boolean;
  /** Ask before removing an entry (the modal confirms); without it the entry is removed at once. */
  onRemove?: (index: number) => void;
  /** How many properties have at least one owner email (owners are verified against these). */
  ownerEmailProperties?: number;
}) {
  const d = value;
  const errors = errorMap(routingDraftProblems(d, ownLine));
  const updEntry = (i: number, patch: Partial<RoutingEntryDraft>) =>
    onChange({ ...d, entries: d.entries.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= d.entries.length) return;
    const next = [...d.entries];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...d, entries: next });
  };
  const remove = (i: number) => (onRemove ? onRemove(i) : onChange({ ...d, entries: d.entries.filter((_, k) => k !== i) }));
  const reachable = d.entries.filter((e) => e.phone.trim()).length;
  const warnings = routingWarnings(d);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-accent px-3 py-2 text-[13px] text-accent-foreground">
        <span className="font-medium">Existing owners only.</span> Sarah offers this menu only after the caller says they own a
        property that 518 Property Pro manages. Tenants, prospects and everyone else never hear about it and are never put
        through. When an owner picks someone (by name, role or keypad key) and is verified, Sarah checks their hours and puts
        the call through to that number. If they don&apos;t pick up, the call goes to that phone&apos;s own voicemail, if it has one; it
        does not come back to Sarah.
      </div>
      <div className="rounded-xl border border-border px-3 py-2 text-[13px]">
        <span className="font-medium">Owners are verified before any transfer.</span> Sarah asks which property they own and
        the email address on file for it, and puts the call through only if that email matches one of the property&apos;s
        owner emails (2 tries, then she takes a message).
        {ownerEmailProperties !== undefined ? (
          <span className="text-muted-foreground">
            {" "}
            {ownerEmailProperties === 1 ? "1 property has" : `${ownerEmailProperties} properties have`} owner emails on file
            (Property page). Owners of other properties can only leave a message.
          </span>
        ) : null}
      </div>
      <div role="alert" className="rounded-xl bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning-ink">
        {NO_PRESS_ZERO_WARNING} There is no general &quot;press 0&quot; route.
      </div>
      {warnings.map((w) => (
        <div key={w} role="alert" className="rounded-xl bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning-ink">
          {w}
        </div>
      ))}

      {showEnable ? (
        <div>
          <div className="flex items-center gap-3">
            <Toggle
              label="Routing directory enabled"
              checked={d.enabled}
              disabled={readOnly}
              onChange={(enabled) => onChange({ ...d, enabled })}
            />
            <span className="text-sm">
              {d.enabled ? "On" : "Off"}
              <span className="text-muted-foreground">
                {" "}
                · {reachable} of {d.entries.length} {d.entries.length === 1 ? "person has" : "people have"} a number
              </span>
            </span>
          </div>
          <FieldError message={errors.enabled} />
          <p className="mt-1 text-xs text-muted-foreground">
            The menu offers only people with a number. For the others Sarah says they aren&apos;t available by phone and takes a
            message. It also needs the &quot;Owner call routing menu&quot; call type switched on and approved, then a publish.
          </p>
        </div>
      ) : null}

      <Field
        label="Main office number (optional)"
        hint="The client's main number that their phone company forwards to Sarah. Nobody can be put through to it, because that would ring straight back to Sarah."
      >
        <div className="sm:w-64">
          <PhoneField
            label="Main office number"
            placeholder="518-555-0100"
            value={d.mainOfficeNumber}
            readOnly={readOnly}
            error={errors.mainOfficeNumber}
            onChange={(mainOfficeNumber) => onChange({ ...d, mainOfficeNumber })}
          />
        </div>
      </Field>

      <div className="space-y-3">
        {d.entries.map((e, i) => {
          const who = e.label.trim() || `key ${i + 1}`;
          const f = (k: string) => errors[`entries.${i}.${k}`];
          return (
            <div key={i} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-start gap-2">
                <div
                  className="flex h-9 shrink-0 items-center justify-center rounded-lg bg-muted px-2.5 text-sm font-semibold"
                  title={`Press ${i + 1}`}
                >
                  Key {i + 1}
                </div>
                <div className="min-w-40 flex-1">
                  <Input
                    aria-label={`Name for key ${i + 1}`}
                    aria-invalid={!!f("label")}
                    maxLength={100}
                    readOnly={readOnly}
                    placeholder="Name, e.g. Delia (Accounting)"
                    value={e.label}
                    onChange={(ev) => updEntry(i, { label: ev.target.value })}
                    className={cx(f("label") && "border-danger-ink")}
                  />
                  <FieldError message={f("label")} />
                </div>
                {!readOnly ? (
                  <div className="flex gap-1">
                    <IconBtn label={`Move ${who} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp />
                    </IconBtn>
                    <IconBtn label={`Move ${who} down`} disabled={i === d.entries.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown />
                    </IconBtn>
                    <IconBtn label={`Remove ${who}`} onClick={() => remove(i)}>
                      <Trash2 />
                    </IconBtn>
                  </div>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-[12rem_7rem_1fr]">
                <Field label="Phone number">
                  <PhoneField
                    label={`Phone number for ${who}`}
                    placeholder="518-555-0123"
                    value={e.phone}
                    readOnly={readOnly}
                    error={f("phone")}
                    onChange={(phone) => updEntry(i, { phone })}
                  />
                  {!e.phone.trim() && !f("phone") ? <p className="mt-1 text-xs text-warning-ink">No number: Sarah takes a message.</p> : null}
                </Field>
                <Field label="Extension">
                  <div>
                    <Input
                      aria-label={`Extension for ${who}`}
                      aria-invalid={!!f("extension")}
                      inputMode="numeric"
                      maxLength={12}
                      readOnly={readOnly}
                      placeholder="Optional"
                      value={e.extension}
                      onChange={(ev) => updEntry(i, { extension: ev.target.value.replace(/[^\d]/g, "") })}
                      className={cx(f("extension") && "border-danger-ink")}
                    />
                    <FieldError message={f("extension")} />
                  </div>
                </Field>
                <Field label="Messages go to" hint="Whose callback list gets a message when this person can't be reached.">
                  <Select
                    aria-label={`Team member who gets messages for ${who}`}
                    disabled={readOnly}
                    value={e.userId || ""}
                    onChange={(ev) => updEntry(i, { userId: ev.target.value || "" })}
                  >
                    <option value="">Team callback list (admins)</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Hours (New York time)">
                <HoursEditor
                  label={`Hours for ${who}`}
                  value={e.hours}
                  readOnly={readOnly}
                  error={f("hours")}
                  onChange={(hours) => updEntry(i, { hours })}
                />
              </Field>
            </div>
          );
        })}
        <FieldError message={errors.entries} />
        {!readOnly && d.entries.length < MAX_ROUTING_ENTRIES ? (
          <Btn sm onClick={() => onChange({ ...d, entries: [...d.entries, { label: "", phone: "", extension: "", hours: "", userId: "" }] })}>
            <Plus className="h-3.5 w-3.5" /> Add person
          </Btn>
        ) : null}
      </div>

      <Field
        label="If nobody answers"
        hint="Sarah says this right before she puts the call through, because she is off the call once it is transferred. For example: “If she can't pick up, you can leave her a voicemail.” Pat and Alex to decide."
      >
        <Textarea
          rows={2}
          maxLength={1000}
          readOnly={readOnly}
          value={d.fallback}
          onChange={(e) => onChange({ ...d, fallback: e.target.value })}
          className={cx(errors.fallback && "border-danger-ink")}
        />
        <FieldError message={errors.fallback} />
      </Field>
      <Field
        label="After hours"
        hint="What Sarah says when the person is outside their hours, before she takes a message. Leave empty for: “Nina isn't available right now. I can take a message and pass it on.” Pat and Alex to decide."
      >
        <Textarea
          rows={2}
          maxLength={1000}
          readOnly={readOnly}
          value={d.afterHours}
          onChange={(e) => onChange({ ...d, afterHours: e.target.value })}
          className={cx(errors.afterHours && "border-danger-ink")}
        />
        <FieldError message={errors.afterHours} />
      </Field>
    </div>
  );
}
