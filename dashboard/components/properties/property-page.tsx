"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Building2, MapPin, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TEAM_LABELS, type Team } from "@/convex/rentPaymentsPolicy";
import { Dialog } from "@/components/properties/dialog";
import { PropertyForm, type PropertyFormValue } from "@/components/properties/property-form";
import { PropertyList } from "@/components/properties/property-list";
import { errorMessage, useToast } from "@/components/toast";
import { rolesOfAccess } from "@/components/require-view";
import { UnitInventory } from "@/components/units/unit-inventory";
import { useManagers } from "@/components/units/use-managers";
import { Avatar, Btn, Card, CardHead, IconTile, KeyValue, PageHeader, Pill, Seg, Select } from "@/components/ui";

type PropertyRow = NonNullable<ReturnType<typeof useProperties>>[number];
function useProperties() {
  return useQuery(api.properties.list);
}

type ApplyTo = "units_without_override" | "all";
type Tab = "units" | "details" | "manager";
const TABS: readonly Tab[] = ["units", "details", "manager"];

export function PropertyPage() {
  const toast = useToast();
  const router = useRouter();
  const search = useSearchParams();
  const access = useQuery(api.team.myAccess);
  const properties = useProperties();
  const managers = useManagers();
  const create = useMutation(api.properties.create);
  // Every role held (B31): an asset manager who is also the accountant gets both sets of controls.
  const roles = rolesOfAccess(access);
  const isAdmin = roles.includes("admin");
  const isAm = roles.includes("asset_manager");
  const isAccountant = roles.includes("accountant");

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  // `?property=<id>` opens one property; without it the list shows. A single property (an asset
  // manager with one building) opens straight away.
  const wanted = search.get("property");
  const property =
    properties?.find((p) => p._id === wanted) ?? (properties?.length === 1 && !wanted ? properties[0] : undefined);
  const canGoBack = (properties?.length ?? 0) > 1;

  const select = (id: string) => router.replace(`/properties?property=${encodeURIComponent(id)}`, { scroll: false });

  return (
    <div className="pb-10">
      {property ? null : (
        <PageHeader
          title="Properties"
          subtitle={
            isAm
              ? "Buildings with units you manage. Open one to toggle availability so Sarah answers leasing questions correctly."
              : "Every building, its units and rent. Open one to see its units, details and asset manager."
          }
        />
      )}

      {properties === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
          {(property && canGoBack) || isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              {property && canGoBack ? (
                <Link
                  href="/properties"
                  scroll={false}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
                >
                  <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
                  All properties
                </Link>
              ) : null}
              {isAdmin ? (
                <Btn sm className="ml-auto" onClick={() => setAdding(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Add property
                </Btn>
              ) : null}
            </div>
          ) : null}

          {!property ? (
            <PropertyList properties={properties} isAm={isAm} onOpen={(p) => select(p._id)} />
          ) : (
            <PropertyBody
              key={property._id}
              property={property}
              managers={managers}
              isAdmin={isAdmin}
              isAm={isAm}
              canFinance={isAdmin || isAccountant}
            />
          )}
        </div>
      )}

      {adding ? (
        <Dialog title="Add property" onClose={() => setAdding(false)}>
          <PropertyForm
            initial={{ name: "", address: null, isPilot: false, gasPhone: "", ownerName: "", ownerEmails: [] }}
            submitLabel="Add property"
            busy={busy}
            showOwner={false}
            onCancel={() => setAdding(false)}
            onSubmit={async (v) => {
              setBusy(true);
              try {
                const id = await create({
                  name: v.name,
                  address: v.address ?? undefined,
                  isPilot: v.isPilot,
                  utilityGasPhone: v.gasPhone || undefined,
                });
                toast("Property added");
                setAdding(false);
                select(id);
              } catch (err) {
                toast(errorMessage(err), "error");
              } finally {
                setBusy(false);
              }
            }}
          />
        </Dialog>
      ) : null}
    </div>
  );
}

/** The property's tabs live in the URL (`?tab=details`); the default (units) is left out. */
function useTab(): [Tab, (t: Tab) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab") ?? "";
  const tab = (TABS as readonly string[]).includes(raw) ? (raw as Tab) : "units";
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params.toString());
    if (t === "units") next.delete("tab");
    else next.set("tab", t);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return [tab, setTab];
}

function PropertyBody({
  property,
  managers,
  isAdmin,
  isAm,
  canFinance,
}: {
  property: PropertyRow;
  managers: { userId: Id<"users">; name: string }[] | undefined;
  isAdmin: boolean;
  isAm: boolean;
  /** Admin view + accountant: the owner link and Change rent. */
  canFinance: boolean;
}) {
  const toast = useToast();
  const update = useMutation(api.properties.updateProfile);
  const [tab, setTab] = useTab();
  const [editing, setEditing] = useState<"profile" | "owner" | null>(null);
  const [busy, setBusy] = useState(false);

  // Same subscriptions as the unit table (Convex shares them): the header's occupancy summary.
  const units = useQuery(api.units.list, { propertyId: property._id });
  const residents = useQuery(api.residents.list, { propertyId: property._id });
  const owners = useQuery(api.properties.linkedOwners, canFinance ? { propertyId: property._id } : "skip");
  const list = managers ?? [];

  const occupancy = useMemo(() => {
    if (!units || !residents) return null;
    const withTenant = new Set(residents.map((r) => r.unitId as string));
    const occupied = units.filter((u) => withTenant.has(u._id)).length;
    return { total: units.length, occupied, vacant: units.length - occupied };
  }, [units, residents]);

  const initial: PropertyFormValue = {
    name: property.name,
    address: property.address ?? null,
    isPilot: property.isPilot,
    gasPhone: property.utilityGasPhone ?? "",
    ownerName: property.ownerName ?? "",
    ownerEmails: property.ownerEmails ?? (property.ownerEmail ? [property.ownerEmail] : []),
  };
  const ownerEmails = initial.ownerEmails;

  /** The exact save the old always-open form made (every field, the same validation). */
  const save = async (v: PropertyFormValue, ok: string) => {
    setBusy(true);
    try {
      await update({
        propertyId: property._id,
        name: v.name,
        address: v.address ?? undefined,
        isPilot: v.isPilot,
        ...(v.gasPhone ? { utilityGasPhone: v.gasPhone } : { clearGasPhone: true }),
        ownerName: v.ownerName,
        ownerEmails: v.ownerEmails,
      });
      toast(ok);
      setEditing(null);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const team = property.category && property.category in TEAM_LABELS ? TEAM_LABELS[property.category as Team] : null;
  const ownerLinks: ReactNode =
    owners && owners.length > 0 ? (
      <>
        {owners.length > 1 ? "Co-owned: " : null}
        {owners.map((o, i) => (
          <span key={o.ownerId}>
            {i > 0 ? ", " : null}
            <Link href={`/owner-statements/owners/${o.ownerId}`} className="font-medium text-primary hover:underline">
              {o.legalName}
            </Link>
          </span>
        ))}
      </>
    ) : property.ownerName ? (
      <span className="font-medium text-foreground">{property.ownerName}</span>
    ) : null;

  return (
    <>
      {/* Header: who / where / how many, and the one main action. */}
      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <IconTile tone="acc">
            <Building2 />
          </IconTile>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-balance text-[20px] font-semibold tracking-[-0.01em]">{property.name}</h1>
              {team ? <Pill>{team}</Pill> : null}
              {property.isPilot ? <Pill tone="vio">Pilot</Pill> : null}
            </div>
            {property.address?.formatted ? (
              <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
                <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate" title={property.address.formatted}>
                  {property.address.formatted}
                </span>
              </p>
            ) : null}
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              {!isAm || canFinance ? <span>Owner: {ownerLinks ?? <span className="text-faint">not linked</span>}</span> : null}
              <span className="tabular-nums">
                {isAm
                  ? `${property.yourUnits} of ${property.unitCount} units yours`
                  : occupancy
                    ? `${occupancy.total} ${occupancy.total === 1 ? "unit" : "units"} · ${occupancy.occupied} occupied · ${occupancy.vacant} vacant`
                    : `${property.unitCount} ${property.unitCount === 1 ? "unit" : "units"}`}
              </span>
            </p>
          </div>
          {isAdmin ? (
            <Btn sm onClick={() => setEditing("profile")}>
              <Pencil aria-hidden className="h-3.5 w-3.5" />
              Edit property
            </Btn>
          ) : null}
        </div>
      </Card>

      <Seg<Tab>
        label="Property sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "units", label: "Units" },
          { value: "details", label: "Details" },
          { value: "manager", label: "Asset manager" },
        ]}
      />

      {tab === "units" ? (
        <UnitInventory
          propertyId={property._id}
          propertyName={property.name}
          defaultAmId={property.defaultAssetManagerUserId}
          managers={list}
          canEdit={isAdmin}
          canToggleOwn={isAm}
          canHistory={isAdmin}
          canChangeRent={canFinance}
        />
      ) : tab === "details" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHead title="Profile" right={isAdmin ? <EditBtn label="Edit profile" onClick={() => setEditing("profile")} /> : undefined} />
            <KeyValue
              items={[
                { label: "Name", value: property.name },
                { label: "Address", value: property.address?.formatted ?? <NotSet /> },
                { label: "Gas utility", value: property.utilityGasPhone ? <span className="tabular-nums">{property.utilityGasPhone}</span> : <NotSet /> },
                { label: "Pilot", value: property.isPilot ? "Yes" : "No" },
                { label: "Team", value: team ?? <NotSet /> },
              ]}
            />
          </Card>

          {!isAm || canFinance ? (
            <Card>
              <CardHead
                title="Owner"
                hint="The owner emails are used by Sarah to verify owners who call. Owners never hear them."
                right={isAdmin ? <EditBtn label="Edit owner details" onClick={() => setEditing("owner")} /> : undefined}
              />
              <KeyValue
                items={[
                  ...(canFinance ? [{ label: "Statements", value: owners === undefined ? "…" : (ownerLinks && owners.length > 0 ? ownerLinks : <span className="text-faint">No owner linked on the Owners page</span>) }] : []),
                  { label: "Roster name", value: property.ownerName ?? <NotSet /> },
                  {
                    label: "Emails",
                    value:
                      ownerEmails.length > 0 ? (
                        <ul className="space-y-0.5">
                          {ownerEmails.map((e) => (
                            <li key={e} className="break-all">
                              {e}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <NotSet />
                      ),
                  },
                ]}
              />
            </Card>
          ) : null}

          <Card>
            <CardHead title="Leasing rules" hint="What Sarah's qualification check reads for this building." />
            <KeyValue
              items={[
                {
                  label: "Pets",
                  value: property.petsAllowed === true ? "Allowed" : property.petsAllowed === false ? "Not allowed" : <NotSet text="No pet policy entered" />,
                },
                {
                  label: "Move-in window",
                  value: property.moveInWindowDays !== undefined ? `${property.moveInWindowDays} days` : <NotSet />,
                },
              ]}
            />
          </Card>
        </div>
      ) : (
        <AssetManagerCard property={property} managers={list} isAdmin={isAdmin} isAm={isAm} />
      )}

      {editing ? (
        <Dialog title={editing === "profile" ? "Edit property" : "Edit owner details"} onClose={() => setEditing(null)}>
          <PropertyForm
            initial={initial}
            section={editing}
            submitLabel="Save"
            busy={busy}
            onCancel={() => setEditing(null)}
            onSubmit={(v) => void save(v, editing === "profile" ? "Profile saved" : "Owner details saved")}
          />
        </Dialog>
      ) : null}
    </>
  );
}

function NotSet({ text = "Not set" }: { text?: string }) {
  return <span className="text-faint">{text}</span>;
}

function EditBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Btn sm onClick={onClick} aria-label={label}>
      <Pencil aria-hidden className="h-3.5 w-3.5" />
      Edit
    </Btn>
  );
}

/** The Asset manager tab: the property's default AM and how far a change spreads (unchanged behaviour). */
function AssetManagerCard({
  property,
  managers,
  isAdmin,
  isAm,
}: {
  property: PropertyRow;
  managers: { userId: Id<"users">; name: string }[];
  isAdmin: boolean;
  isAm: boolean;
}) {
  const toast = useToast();
  const setDefault = useMutation(api.properties.setDefaultAssetManager);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Id<"users"> | null>(null);
  const [applyTo, setApplyTo] = useState<ApplyTo>("units_without_override");

  // AMs may not read the team list; fall back to the name carried on their visible units.
  const amUnits = useQuery(api.units.list, isAm ? { propertyId: property._id } : "skip");
  const defaultId = property.defaultAssetManagerUserId;
  const defaultName =
    managers.find((m) => m.userId === defaultId)?.name ?? amUnits?.find((u) => u.assetManagerUserId === defaultId)?.assetManagerName;
  const pendingName = managers.find((m) => m.userId === pending)?.name ?? "this person";
  const sameCount = property.unitCount - property.overrideCount;

  return (
    <>
      <Card accentLine>
        <CardHead
          title="Asset manager"
          hint="Sarah sends this property’s maintenance requests, escalations and tour bookings to this person. Every unit follows it unless you pick someone else for that unit on the Units tab."
        />
        <div className="flex flex-wrap items-center gap-3">
          {defaultName ? <Avatar name={defaultName} /> : null}
          {isAdmin ? (
            <Select
              aria-label="Default asset manager"
              className="w-60"
              value={defaultId ?? ""}
              onChange={(e) => e.target.value && setPending(e.target.value as Id<"users">)}
            >
              {!defaultId ? (
                <option value="" disabled>
                  Choose an asset manager
                </option>
              ) : null}
              {managers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          ) : (
            <span className="font-medium">{defaultName ?? "No default set"}</span>
          )}
          <span className={isAm ? "hidden" : "text-[13px] text-muted-foreground"}>
            {defaultId ? (
              <>
                {sameCount} of {property.unitCount} units
                {property.overrideCount > 0 ? ` · ${property.overrideCount} assigned to someone else` : ""}
              </>
            ) : (
              "No default yet"
            )}
          </span>
          {isAdmin ? (
            <Link href="/asset-managers" className="ml-auto text-[13px] font-medium text-primary hover:underline">
              All asset managers →
            </Link>
          ) : null}
        </div>
      </Card>

      {pending ? (
        <Dialog title="Change the default asset manager" onClose={() => setPending(null)}>
          <p className="text-sm text-muted-foreground">
            Make <span className="font-medium text-foreground">{pendingName}</span> the default for {property.name}. Which units
            should switch to them?
          </p>
          <fieldset className="mt-4 space-y-2">
            <legend className="sr-only">Apply to</legend>
            {(
              [
                ["units_without_override", "Units without an override", "Units already assigned to someone else keep their asset manager."],
                ["all", "All units", "Every unit moves to this person, including overrides."],
              ] as const
            ).map(([value, label, note]) => (
              <label
                key={value}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border px-3 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-accent"
              >
                <input type="radio" name="apply-to" checked={applyTo === value} onChange={() => setApplyTo(value)} className="mt-1" />
                <span>
                  <span className="block text-[13.5px] font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{note}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="mt-4 flex justify-end gap-2">
            <Btn onClick={() => setPending(null)}>Cancel</Btn>
            <Btn
              variant="pri"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await setDefault({ propertyId: property._id, userId: pending, applyTo });
                  toast(`${property.name} now routes to ${pendingName} · ${res.changed} of ${res.total} units updated`);
                  setPending(null);
                } catch (err) {
                  toast(errorMessage(err), "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving…" : "Confirm"}
            </Btn>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
