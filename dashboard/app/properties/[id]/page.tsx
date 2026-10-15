import { redirect } from "next/navigation";

// Old deep link; the Property page selects the building via ?property=<id>.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/properties?property=${encodeURIComponent(id)}`);
}
