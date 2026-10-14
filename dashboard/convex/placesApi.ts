import { ConvexError, v, type Infer } from "convex/values";

/**
 * Thin wrapper over Google's Places API (New) for the property address box. Same style as
 * googleApi.ts: fetch-based, no SDK, runs on Convex's default runtime.
 *
 * The API key never reaches the browser — the page calls places.autocomplete / places.details,
 * which call this. That keeps the key unrestricted by referrer without being exposed, and lets
 * those actions require a signed-in team member so the key cannot be used as a free proxy.
 */

// Shared with schema.ts and properties.save, so the three can never disagree on the shape.
export const propertyAddressValidator = v.object({
  formatted: v.string(),
  // Absent when someone typed an address without picking a suggestion: saved as written, but
  // not pinned to an exact place.
  placeId: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  mapsUrl: v.optional(v.string()),
});
export type PropertyAddress = Infer<typeof propertyAddressValidator>;

export type AddressSuggestion = { placeId: string; mainText: string; secondaryText: string };

const PLACES_API = "https://places.googleapis.com/v1";

// ConvexError rather than Error for everything the address box shows: a plain Error reaches the
// page wrapped in request ids and a server stack trace, which is no message for a property
// manager. The operator detail goes to the deployment logs instead.
const UNAVAILABLE = "Address search is unavailable right now. You can still type the address and save it.";

function apiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.error("GOOGLE_MAPS_API_KEY is not set. Set it with: npx convex env set GOOGLE_MAPS_API_KEY <value>");
    throw new ConvexError("Address search isn't set up yet. You can still type the address and save it.");
  }
  return key;
}

/**
 * The session token groups the keystrokes of one search with the details lookup that ends it,
 * which is what Google bills as a single session rather than a request per keystroke.
 */
export async function autocomplete(input: string, sessionToken: string): Promise<AddressSuggestion[]> {
  const res = await fetch(`${PLACES_API}/places:autocomplete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey() },
    body: JSON.stringify({ input, sessionToken, languageCode: "en" }),
  });
  if (!res.ok) throw await placesError(res, "autocomplete");

  const body = (await res.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId: string;
        text?: { text: string };
        structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
      };
    }>;
  };
  return (body.suggestions ?? []).flatMap((s) => {
    const p = s.placePrediction;
    if (!p) return [];
    return [
      {
        placeId: p.placeId,
        mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
      },
    ];
  });
}

export async function details(placeId: string, sessionToken: string): Promise<PropertyAddress> {
  const params = new URLSearchParams({ sessionToken, languageCode: "en" });
  const res = await fetch(`${PLACES_API}/places/${encodeURIComponent(placeId)}?${params}`, {
    headers: {
      "X-Goog-Api-Key": apiKey(),
      // Only what we store. The field mask also decides the price tier of the request.
      "X-Goog-FieldMask": "id,formattedAddress,location,googleMapsUri",
    },
  });
  if (!res.ok) throw await placesError(res, "details");

  const body = (await res.json()) as {
    id: string;
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    googleMapsUri?: string;
  };
  if (!body.formattedAddress) {
    throw new ConvexError("Google has no street address for that place. Try a more specific suggestion.");
  }
  return {
    formatted: body.formattedAddress,
    placeId: body.id,
    lat: body.location?.latitude,
    lng: body.location?.longitude,
    mapsUrl: body.googleMapsUri,
  };
}

async function placesError(res: Response, what: string): Promise<ConvexError<string>> {
  const detail = await res.text();
  console.error(`Google Places ${what} ${res.status}: ${detail.slice(0, 500)}`);
  return new ConvexError(UNAVAILABLE);
}
