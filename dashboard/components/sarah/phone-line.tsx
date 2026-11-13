"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { Btn, Card, CardHead, Field, Input, Pill, Select } from "@/components/ui";
import { errorMessage, useToast } from "@/components/toast";

/**
 * "Business line forwarding (optional)". The admin enters their existing office number; THEY set
 * up forwarding at their carrier. Nothing here changes any carrier, and the badge never says
 * forwarding works until a call has actually been seen after they confirmed the setup.
 * Saves immediately: this is not prompt behaviour, so it is separate from Sarah's Save.
 */

type LineType = "verizon_mobile" | "other_mobile" | "landline_office" | "phone_system" | "unknown";

const LINE_OPTIONS: ReadonlyArray<{ value: LineType; label: string }> = [
  { value: "verizon_mobile", label: "Verizon mobile" },
  { value: "other_mobile", label: "Other mobile" },
  { value: "landline_office", label: "Office landline" },
  { value: "phone_system", label: "Phone system (RingCentral, Google Voice, etc.)" },
  { value: "unknown", label: "Not sure" },
];

const STATUS: Record<"not_set" | "saved" | "waiting" | "call_seen", { label: string; tone: "neutral" | "acc" | "warn" | "ok" }> = {
  not_set: { label: "Not set", tone: "neutral" },
  saved: { label: "Number saved", tone: "acc" },
  waiting: { label: "Waiting for a test call", tone: "warn" },
  call_seen: { label: "Call seen", tone: "ok" },
};

function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12.5px]">{children}</code>;
}

/** US-style display of an E.164 number so the codes below are easy to dial. */
function digitsOf(n: string): string {
  return n.replace(/\D/g, "");
}

function Instructions({ lineType, target }: { lineType: LineType; target: string }) {
  const tenDigit = digitsOf(target).replace(/^1(?=\d{10}$)/, "");
  if (lineType === "verizon_mobile") {
    return (
      <div className="space-y-1.5 text-sm">
        <p className="text-xs text-muted-foreground">Verified against Verizon&apos;s call forwarding support page.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>All calls: dial <Code>*72{tenDigit}</Code> and wait for the confirmation tone.</li>
          <li>Only when you don&apos;t answer: dial <Code>*71{tenDigit}</Code>.</li>
          <li>Turn forwarding off: dial <Code>*73</Code>.</li>
        </ul>
      </div>
    );
  }
  if (lineType === "other_mobile") {
    return (
      <div className="space-y-1.5 text-sm">
        <p className="text-xs text-muted-foreground">Standard codes, confirm with your carrier. Not every carrier supports them.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>All calls: dial <Code>**21*{target}#</Code></li>
          <li>Only when unanswered: dial <Code>**61*{target}#</Code></li>
          <li>Cancel: dial <Code>##21#</Code></li>
        </ul>
      </div>
    );
  }
  if (lineType === "landline_office") {
    return (
      <p className="text-sm">
        Ask your phone provider to turn on call forwarding (all calls, busy, or no answer) to <Code>{target}</Code>.
      </p>
    );
  }
  if (lineType === "phone_system") {
    return (
      <p className="text-sm">
        Set a forwarding or ring-group rule to <Code>{target}</Code> in your phone system&apos;s admin portal (RingCentral,
        Google Voice, Teams, 8x8). After-hours rules live there too.
      </p>
    );
  }
  return (
    <p className="text-sm">
      Not sure what kind of line it is? Pick the closest type above, or ask your phone provider to forward calls (all
      calls, busy, or no answer) to <Code>{target}</Code>.
    </p>
  );
}

export function PhoneLine() {
  const info = useQuery(api.orgSettings.forwardingGet);
  const save = useMutation(api.orgSettings.forwardingSave);
  const confirm = useMutation(api.orgSettings.forwardingConfirm);
  const clear = useMutation(api.orgSettings.forwardingClear);
  const toast = useToast();

  // null = untouched: the form shows the server's values, so later server changes never fight typing.
  const [edit, setEdit] = useState<{ number: string; lineType: LineType } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!info) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const number = edit?.number ?? info.number ?? "";
  const lineType = edit?.lineType ?? info.lineType;
  const setNumber = (n: string) => setEdit({ number: n, lineType });
  const setLineType = (t: LineType) => setEdit({ number, lineType: t });
  const status = STATUS[info.status];
  const dirty = edit !== null;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const onSave = () =>
    run("save", async () => {
      const r = await save({ number: number.trim() || undefined, lineType });
      if (r.cleared) {
        toast("Forwarding removed", "success");
      } else {
        toast("Number saved", "success");
        for (const w of r.warnings) toast(w, "warning");
      }
      setEdit(null); // show the normalised value from the server
    });

  const onClear = () =>
    run("clear", async () => {
      await clear({});
      setEdit(null);
      toast("Forwarding removed", "success");
    });

  const onConfirm = () =>
    run("confirm", async () => {
      await confirm({});
      toast("Noted. Now call your office number from another phone.", "success");
    });

  const copy = async () => {
    if (!info.ourNumber) return;
    try {
      await navigator.clipboard.writeText(info.ourNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Could not copy. Select the number and copy it manually.", "error");
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <CardHead
          title="Business line forwarding (optional)"
          hint="Already have an office number customers call? Forward it to Sarah. This is optional."
          badge={<Pill tone={status.tone} dot>{status.label}</Pill>}
        />

        {info.ourNumber ? (
          <Field label="Forward your office number to this number (Sarah's number)">
            <div className="flex flex-wrap items-center gap-2">
              <Code>{info.ourNumber}</Code>
              <Btn sm onClick={copy} aria-label="Copy Sarah's number">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Btn>
            </div>
          </Field>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-border bg-muted p-3 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <strong>{info.ourNumberMessage}</strong>
              <p className="text-muted-foreground">
                Sarah has no phone number yet, so there is nothing to forward to. Connect your Twilio number to Sarah
                first (an operator runs <Code>agents:connectPhoneNumber</Code>), then come back here.
              </p>
            </div>
          </div>
        )}

        <Field label="Your office number" hint="Leave empty if you don't want forwarding.">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={40}
            placeholder="518 555 0100"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </Field>
        <Field label="What kind of line is it?">
          <Select value={lineType} onChange={(e) => setLineType(e.target.value as LineType)}>
            {LINE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="pri" onClick={onSave} disabled={busy !== null || !dirty}>
            {busy === "save" ? "Saving…" : "Save"}
          </Btn>
          {info.number ? (
            <Btn onClick={onClear} disabled={busy !== null}>
              {busy === "clear" ? "Removing…" : "Clear"}
            </Btn>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          This saves immediately. It is separate from Sarah&apos;s Save, because it doesn&apos;t change what she says.
          Saving only stores the number here; it does not change anything at your phone carrier.
        </p>

        {info.lastSeenAt ? (
          <p className="text-sm">
            Last call seen {relativeTime(info.lastSeenAt, now)}
            {info.lastSeenLast4 ? <> from …{info.lastSeenLast4}</> : null}.
          </p>
        ) : null}
      </Card>

      {info.number ? (
        <Card className="space-y-3">
          <CardHead title="Set it up and test it" />
          <ol className="list-decimal space-y-3 pl-5 text-sm">
            <li className="space-y-2">
              <span>Set forwarding at your carrier.</span>
              {info.ourNumber ? (
                <Instructions lineType={lineType} target={info.ourNumber} />
              ) : (
                <p className="text-muted-foreground">Connect your Twilio number first so we can show the exact steps.</p>
              )}
            </li>
            <li className="space-y-2">
              <span>Once it is set, tell us.</span>
              <div>
                <Btn
                  variant="pri"
                  onClick={onConfirm}
                  disabled={busy !== null || !info.ourNumber || info.status === "waiting" || info.status === "call_seen"}
                >
                  {busy === "confirm" ? "Saving…" : info.confirmedAt ? "Set up (confirmed)" : "I've set it up"}
                </Btn>
              </div>
            </li>
            <li>Call your office number from another phone.</li>
            <li>
              When Sarah answers, the badge changes to <strong>Call seen</strong>. It changes for any call Sarah takes,
              including calls made straight to her number, so we can&apos;t tell a forwarded call from a direct one.
              {info.status === "call_seen" ? (
                <Pill tone="ok" className="mt-1">Verified by a test call</Pill>
              ) : null}
            </li>
          </ol>
        </Card>
      ) : null}

      <Card className="space-y-2">
        <CardHead title="Good to know" />
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>
            <strong>Never route emergencies or 911 through Sarah.</strong> Only forward your regular business line.
          </li>
          <li>
            Some carriers replace the caller&apos;s number when they forward a call, so Sarah&apos;s caller-ID lookup of
            tenants may not match.
          </li>
          <li>Your carrier may bill you for forwarded minutes.</li>
          <li>
            If your office number is on Twilio, import it directly instead (same as Sarah&apos;s number) so no forwarding is
            needed.
          </li>
          <li>Removing forwarding at your carrier is up to you (on Verizon, dial *73). Clearing it here doesn&apos;t change your carrier.</li>
        </ul>
      </Card>
    </div>
  );
}
