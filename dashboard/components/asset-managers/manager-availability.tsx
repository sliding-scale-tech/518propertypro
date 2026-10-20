"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "@/components/toast";
import { AvailabilityModal } from "./availability-modal";

/** Admin editing one asset manager's weekly tour hours (assetManagers.availability / setAvailability). */
export function ManagerAvailabilityModal({ userId, onClose, onSaved }: { userId: Id<"users">; onClose: () => void; onSaved?: () => void }) {
  const availability = useQuery(api.assetManagers.availability, { userId });
  const setAvailability = useMutation(api.assetManagers.setAvailability);
  if (!availability) return null;
  return (
    <AvailabilityModal
      initial={availability.days.map((d) => ({ day: d.day, start: d.start, end: d.end }))}
      onClose={onClose}
      onSave={async (hours) => {
        const byDay = new Map(hours.map((h) => [h.day, h]));
        await setAvailability({
          userId,
          hours: [0, 1, 2, 3, 4, 5, 6].map((day) => {
            const h = byDay.get(day);
            return { day, start: h?.start ?? null, end: h?.end ?? null };
          }),
        });
        toast.success("Availability updated");
        onSaved?.();
        onClose();
      }}
    />
  );
}
