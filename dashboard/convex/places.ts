import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireOrgId } from "./authz";
import * as placesApi from "./placesApi";

/**
 * The Property page's address search. Both require a signed-in team member: each call spends
 * this deployment's Google Maps quota, so an anonymous caller must not be able to run them.
 */

export const autocomplete = action({
  args: { input: v.string(), sessionToken: v.string() },
  handler: async (ctx, args): Promise<placesApi.AddressSuggestion[]> => {
    await requireOrgId(ctx);
    const input = args.input.trim().slice(0, 200);
    if (input.length < 3) return [];
    return placesApi.autocomplete(input, args.sessionToken);
  },
});

export const details = action({
  args: { placeId: v.string(), sessionToken: v.string() },
  handler: async (ctx, args): Promise<placesApi.PropertyAddress> => {
    await requireOrgId(ctx);
    return placesApi.details(args.placeId, args.sessionToken);
  },
});
