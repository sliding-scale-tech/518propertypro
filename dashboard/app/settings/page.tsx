"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useToast } from "@/components/toast";
import { RUBRIC } from "@/convex/leadScoring";
import { RESIDENT_TRIAGE_BLOCK } from "@/convex/residentTriage";
import {
  hasUnknownWording,
  needsScreeningUpgrade,
  upgradeForScreening,
} from "@/convex/screeningPrompt";
import { SEVERITY_RUBRIC } from "@/convex/severity";
import { WA_DEFAULT_PROMPT } from "@/convex/waPrompt";
import { Bot, Users, Gauge, AlertTriangle, MessageCircle } from "lucide-react";

export default function SettingsPage() {
  const toast = useToast();
  const agent = useQuery(api.agents.current);
  const saveAgent = useAction(api.agents.saveAgent);
  const listVoices = useAction(api.agents.voices);

  const orgSettings = useQuery(api.orgSettings.current);
  const saveOrgSettings = useMutation(api.orgSettings.save);
  const [staffPhoneNumber, setStaffPhoneNumber] = useState("");
  const [staffHydrated, setStaffHydrated] = useState(false);
  const [staffStatus, setStaffStatus] = useState<"idle" | "saving">("idle");

  // WhatsApp keeps its own prompt. The two channels genuinely need different instructions --
  // the voice prompt names tools that do not exist on WhatsApp, and the WhatsApp prompt tells
  // the model to fill JSON fields, which would make Sarah read JSON aloud on a call.
  const waConfig = useQuery(api.whatsapp.config);
  const saveWaConfig = useMutation(api.whatsapp.saveConfig);
  const [waStatus, setWaStatus] = useState<"idle" | "saving">("idle");

  // Derived rather than mirrored into an effect: waDraft is null until the user actually
  // types, and the saved value shows through until then. That keeps the textarea in sync with
  // the database without the hydrate-once effect this file uses elsewhere, which React now
  // warns about because it causes a second render on every load.
  const [waDraft, setWaDraft] = useState<string | null>(null);
  const waLoading = waConfig === undefined;
  // A blank stored prompt means "use the default" - that is how waBot reads it too
  // (`config?.systemPrompt?.trim() || WA_DEFAULT_PROMPT`). Using ?? here instead of this
  // check would treat an empty string as a real value and show an empty box for a bot that
  // is actually running the default.
  const waSaved = waConfig?.systemPrompt?.trim() ? waConfig.systemPrompt : null;
  const waPrompt = waDraft ?? waSaved ?? WA_DEFAULT_PROMPT;

  useEffect(() => {
    if (!orgSettings || staffHydrated) return;
    setStaffPhoneNumber(orgSettings.staffPhoneNumber);
    setStaffHydrated(true);
  }, [orgSettings, staffHydrated]);

  const handleSaveStaff = async () => {
    setStaffStatus("saving");
    await saveOrgSettings({ staffPhoneNumber });
    setStaffStatus("idle");
    toast("Staff phone number saved");
  };

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<Array<{ voiceId: string; name: string }>>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!agent || hydrated) return;
    setName(agent.name);
    setPrompt(agent.prompt);
    setFirstMessage(agent.firstMessage);
    setVoiceId(agent.voiceId);
    setHydrated(true);
  }, [agent, hydrated]);

  useEffect(() => {
    listVoices()
      .then(setVoices)
      .catch(() => {
        /* voice list is a convenience; the id field still works without it */
      });
  }, [listVoices]);

  const handleSave = async () => {
    setStatus("saving");
    setError(null);
    try {
      await saveAgent({ name, prompt, firstMessage, voiceId });
      setStatus("idle");
      toast("Agent saved — changes apply to the next call");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not save the agent.");
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes apply to the next call. Existing knowledge documents stay attached.
        </p>
      </div>

      <Section icon={Bot} title="Agent configuration">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>

        <Field label="First message" hint="What the agent says the moment the call connects.">
          <input
            value={firstMessage}
            onChange={(e) => setFirstMessage(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="System prompt" hint="Keep it short — long prompts make voice replies rambly.">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={8}
            className={`${inputClass} resize-y`}
          />
        </Field>

        {/* The live prompt lives in the database, not in the code — saveAgent resolves
            args.prompt ?? existing.prompt, so editing the constant in agents.ts does nothing to
            an agent that already exists. This button is how the resident-triage instructions
            actually reach Sarah. It appends rather than replaces so hand edits made right here
            in the textarea aren't silently thrown away. */}
        {!prompt.includes("RESIDENT CALLS") && (
          <div className="rounded-lg border border-dashed border-border p-3">
            <div className="text-sm font-medium">Resident triage is not in this prompt yet</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Adds the severity scale and the rules for handling existing residents. It only
              appends — if your prompt still tells Sarah to escalate every tenant issue, delete
              that line by hand above, then save.
            </p>
            <button
              type="button"
              onClick={() => setPrompt(`${prompt.trimEnd()}

${RESIDENT_TRIAGE_BLOCK}`)}
              className="mt-3 rounded-lg border border-input px-3 py-1.5 text-sm hover:bg-accent"
            >
              Insert resident triage instructions
            </button>
          </div>
        )}

        {/* Same story as the resident-triage button above: the live prompt is in the database,
            so an agent created before pre-screening questions existed still carries the old
            wording that says the five built-in fields are the only things Sarah may ask and
            the only things that can disqualify. That now contradicts the questions block, and
            a model given two contradictory instructions follows whichever it likes. */}
        {needsScreeningUpgrade(prompt) && (
          <div className="rounded-lg border border-dashed border-border p-3">
            <div className="text-sm font-medium">
              This prompt still says the five built-in questions are the only ones
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Your pre-screening questions are set on the Property page, but this prompt tells
              Sarah not to ask anything beyond the built-in five. This rewrites those two
              passages and marks where the questions get inserted.
              {hasUnknownWording(prompt)
                ? " Heads up: parts of this prompt have been edited by hand, so some of the old wording will survive — check the text above after applying and delete anything that still says five questions are all there is."
                : ""}
            </p>
            <button
              type="button"
              onClick={() => setPrompt(upgradeForScreening(prompt))}
              className="mt-3 rounded-lg border border-input px-3 py-1.5 text-sm hover:bg-accent"
            >
              Update prompt for pre-screening questions
            </button>
          </div>
        )}

        <Field label="Voice">
          {voices.length > 0 ? (
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={inputClass}>
              {voices.map((v) => (
                <option key={v.voiceId} value={v.voiceId}>
                  {v.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          )}
        </Field>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={status === "saving"}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : "Save agent"}
          </button>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>

        {agent && <p className="pt-1 font-mono text-xs text-muted-foreground">{agent.elevenLabsAgentId}</p>}
      </Section>

      <Section icon={Users} title="Staff notifications">
        <p className="-mt-2 text-sm text-muted-foreground">
          Where escalation alerts and call summaries get texted. Overrides the STAFF_PHONE_NUMBER
          environment variable if set here.
        </p>

        <Field label="Staff phone number" hint="E.164 format, e.g. +923312298823">
          <input
            value={staffPhoneNumber}
            onChange={(e) => setStaffPhoneNumber(e.target.value)}
            placeholder="+1..."
            className={`${inputClass} font-mono`}
          />
        </Field>

        <button
          onClick={handleSaveStaff}
          disabled={staffStatus === "saving"}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {staffStatus === "saving" ? "Saving…" : "Save"}
        </button>
      </Section>

      <Section icon={Gauge} title="Lead scoring">
        <p className="-mt-2 text-sm text-muted-foreground">
          Every lead call gets a 0–10 score, computed deterministically from what the call
          actually captured — no AI judgment involved, so it's always explainable. Here's exactly
          how it's calculated:
        </p>

        <div className="space-y-2">
          {RUBRIC.map((r) => (
            <div key={r.label} className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                +{r.points}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground">{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          A confirmed disqualification (wrong budget or pet policy) caps the score at 4, no
          matter how the rest adds up — an ineligible lead isn't a near-term opportunity.
        </p>
      </Section>

      <Section icon={MessageCircle} title="WhatsApp prompt">
        <p className="-mt-2 text-sm text-muted-foreground">
          Sarah&apos;s instructions when she is texting on WhatsApp. Separate from the voice
          prompt above on purpose: that one tells her to call tools like{" "}
          <code className="font-mono text-xs">check_qualification</code> and end the call, none
          of which exist in a chat, and this one tells her to fill in structured fields, which
          she would otherwise read out loud on a phone call.
        </p>

        <Field
          label="System prompt"
          hint="Keep the {{...}} placeholders. They are filled in automatically on every message."
        >
          <textarea
            value={waLoading ? "" : waPrompt}
            onChange={(e) => setWaDraft(e.target.value)}
            disabled={waLoading}
            rows={12}
            className={`${inputClass} resize-y font-mono text-xs`}
          />
        </Field>

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="text-xs font-medium">Filled in automatically, do not delete</div>
          <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
            <li>
              <code className="font-mono">{"{{PROPERTY}}"}</code> — units, rent and availability,
              live from the Property page
            </li>
            <li>
              <code className="font-mono">{"{{DOCS}}"}</code> — every synced Knowledge document
            </li>
            <li>
              <code className="font-mono">{"{{SEVERITY_RUBRIC}}"}</code> — the 1&ndash;10 bands
              shown below
            </li>
            <li>
              <code className="font-mono">{"{{PROPERTY_NAME}}"}</code> — the property name
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            You never need to type rent or policies in here. Change them on the Property and
            Knowledge pages and both channels pick it up.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={async () => {
              setWaStatus("saving");
              await saveWaConfig({ systemPrompt: waPrompt });
              // Drop the draft so the field follows the saved value again.
              setWaDraft(null);
              setWaStatus("idle");
              toast("WhatsApp prompt saved");
            }}
            disabled={waLoading || waStatus === "saving" || !waPrompt.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {waStatus === "saving" ? "Saving…" : "Save WhatsApp prompt"}
          </button>

          {waPrompt !== WA_DEFAULT_PROMPT && (
            <button
              type="button"
              onClick={() => setWaDraft(WA_DEFAULT_PROMPT)}
              className="rounded-lg border border-input px-4 py-2 text-sm hover:bg-accent"
            >
              Restore default
            </button>
          )}

          <span className="text-xs text-muted-foreground">
            Applies to the next message — no redeploy, no reconnecting WhatsApp.
          </span>
        </div>
      </Section>

      <Section icon={AlertTriangle} title="Severity scale">
        <p className="-mt-2 text-sm text-muted-foreground">
          Every resident call on the Tenants page gets a 1–10 severity. Unlike lead scoring, this one
          is Sarah&apos;s judgment during the call — these exact bands are written into her
          instructions from the same source as this list, so the two can never drift apart. You
          can override any score on the Tenants page; the original is kept.
        </p>

        <div className="space-y-2">
          {SEVERITY_RUBRIC.map((r) => (
            <div key={r.band} className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                {r.band}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground">{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Sarah scores the issue, not the caller — a calm person with no heat is a 9, someone
          furious about a parking space is still a 3. Anything 8 or above is also escalated.
        </p>
      </Section>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Bot;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </h2>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {children}
    </label>
  );
}
