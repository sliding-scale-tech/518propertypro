"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Building2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog } from "@/components/properties/dialog";
import { PropertyForm } from "@/components/properties/property-form";
import { PropertyList } from "@/components/properties/property-list";
import { errorMessage, useToast } from "@/components/toast";
import { UnitInventory } from "@/components/units/unit-inventory";
import { useManagers } from "@/components/units/use-managers";
import { Avatar, Btn, Card, CardHead, PageHeader, Select } from "@/components/ui";

type PropertyRow = NonNullable<ReturnType<typeof useProperties>>[number];
function useProperties() {
  return useQuery(api.properties.list);
}

type ApplyTo = "units_without_override" | "all";

export function PropertyPage() {
  const toast = useToast();
  const router = useRouter();
  const search = useSearchParams();
  const access = useQuery(api.team.myAccess);
  const properties = useProperties();
  const managers = useManagers();
  const create = useMutation(api.properties.create);
  const isAdmin = access?.view === "admin";
  const isAm = access?.view === "asset_manager";

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
      <PageHeader
        title="Property"
        subtitle={
          isAm
            ? "Units you manage. Toggle availability so Sarah answers leasing questions correctly."
            : "These rules drive the agent’s qualification check on every call. They are read straight from here."
        }
      />

      {properties === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
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
              <Btn sm onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add property
              </Btn>
            ) : null}
          </div>

          {!property ? (
            <PropertyList properties={properties} isAm={isAm} onOpen={(p) => select(p._id)} />
          ) : (
            <PropertyBody
              key={property._id}
              property={property}
              managers={managers}
              isAdmin={isAdmin}
              isAm={isAm}
              canHistory={isAdmin}
              canSetDefault={isAdmin}
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

function PropertyBody({
  property,
  managers,
  isAdmin,
  isAm,
  canHistory,
  canSetDefault,
}: {
  property: PropertyRow;
  managers: { userId: Id<"users">; name: string }[] | undefined;
  isAdmin: boolean;
  isAm: boolean;
  canHistory: boolean;
  canSetDefault: boolean;
}) {
  const toast = useToast();
  const update = useMutation(api.properties.updateProfile);
  const setDefault = useMutation(api.properties.setDefaultAssetManager);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Id<"users"> | null>(null);
  const [applyTo, setApplyTo] = useState<ApplyTo>("units_without_override");

  // AMs may not read the team list; fall back to the name carried on their visible units.
  const amUnits = useQuery(api.units.list, isAm ? { propertyId: property._id } : "skip");
  const list = managers ?? [];
  const defaultId = property.defaultAssetManagerUserId;
  const defaultName =
    list.find((m) => m.userId === defaultId)?.name ??
    amUnits?.find((u) => u.assetManagerUserId === defaultId)?.assetManagerName;
  const pendingName = list.find((m) => m.userId === pending)?.name ?? "this person";
  const sameCount = property.unitCount - property.overrideCount;

  return (
    <>
      <Card>
        <CardHead
          title="Property profile"
          icon={<Building2 />}
          right={
            <>
              {property.ownerName ? `Owner: ${property.ownerName} · ` : ""}
              {isAm ? `${property.yourUnits} of ${property.unitCount} units yours` : `${property.unitCount} units`}
            </>
          }
        />
        {/* key remounts the form with fresh values after a save or a remote change. */}
        <PropertyForm
          key={`${property.updatedAt}`}
          initial={{
            name: property.name,
            address: property.address ?? null,
            isPilot: property.isPilot,
            gasPhone: property.utilityGasPhone ?? "",
            ownerName: property.ownerName ?? "",
            ownerEmails: property.ownerEmails ?? (property.ownerEmail ? [property.ownerEmail] : []),
          }}
          submitLabel="Save"
          busy={busy}
          readOnly={!isAdmin}
          onSubmit={async (v) => {
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
              toast("Profile saved");
            } catch (err) {
              toast(errorMessage(err), "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>

      <Card accentLine>
        <CardHead
          title="Asset manager"
          hint="Sarah sends this property’s maintenance requests, escalations and tour bookings to this person. Every unit follows it unless you pick someone else for that unit below."
        />
        <div className="flex flex-wrap items-center gap-3">
          {defaultName ? <Avatar name={defaultName} /> : null}
          {canSetDefault ? (
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
              {list.map((m) => (
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

      <UnitInventory
        propertyId={property._id}
        defaultAmId={defaultId}
        managers={list}
        canEdit={isAdmin}
        canToggleOwn={isAm}
        canHistory={canHistory}
      />

      {pending ? (
        <Dialog title="Change the default asset manager" onClose={() => setPending(null)}>
          <p className="text-sm text-muted-foreground">
            Make <span className="font-medium text-foreground">{pendingName}</span> the default for{" "}
            {property.name}. Which units should switch to them?
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
                <input
                  type="radio"
                  name="apply-to"
                  checked={applyTo === value}
                  onChange={() => setApplyTo(value)}
                  className="mt-1"
                />
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
