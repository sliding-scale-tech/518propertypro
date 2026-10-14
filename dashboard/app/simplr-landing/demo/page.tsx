import type { Metadata } from "next"
import DemoWidget from "@/components/simplr-landing/DemoWidget"

const TITLE = "Simplr call demo"
const DESCRIPTION =
  "Simplr answers, qualifies, and books tours for every rental inquiry, day or night, so residential property managers never lose a lead to a missed call."

export const metadata: Metadata = {
  // absolute: the root layout's "%s | Simplr" template would otherwise double the name.
  title: { absolute: TITLE },
  description: DESCRIPTION,
}

export default function SimplrLandingDemo() {
  return <DemoWidget />
}
