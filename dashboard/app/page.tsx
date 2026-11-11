import { redirect } from "next/navigation";

// Temporarily disabled so `/` goes straight to login.
// Restore this block to bring back the marketing landing at `/`.
// import type { Metadata } from "next";
// import { LandingPage } from "@/components/landing/landing-page";
// import { landingInter } from "@/components/landing/fonts";
//
// const TITLE = "Simplr | After-hours leasing assistant";
// const DESCRIPTION =
//   "Watch Simplr answer, qualify, and book tours for rental inquiries after hours — then try the live voice agent yourself.";
//
// export const metadata: Metadata = {
//   // absolute: the root layout's "%s | Simplr" template would otherwise double the name.
//   title: { absolute: TITLE },
//   description: DESCRIPTION,
//   openGraph: { siteName: "Simplr", title: TITLE, description: DESCRIPTION, type: "website" },
// };
//
// export default function Home() {
//   return <LandingPage className={landingInter.className} />;
// }

export default function Home() {
  redirect("/sign-in");
}
