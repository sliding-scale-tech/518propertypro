import type { Metadata } from "next"
import IconSprite from "@/components/simplr-landing/IconSprite"
import Footer from "@/components/simplr-landing/Footer"
import Hero from "@/components/simplr-landing/sections/Hero"
import Stats from "@/components/simplr-landing/sections/Stats"
import Cold from "@/components/simplr-landing/sections/Cold"
import Features from "@/components/simplr-landing/sections/Features"
import Answered from "@/components/simplr-landing/sections/Answered"
import Impact from "@/components/simplr-landing/sections/Impact"
import Everyone from "@/components/simplr-landing/sections/Everyone"
import Process from "@/components/simplr-landing/sections/Process"
import Faq from "@/components/simplr-landing/sections/Faq"
import Contact from "@/components/simplr-landing/sections/Contact"

const TITLE = "Simplr | Revenue Operations for Property Managers"
const DESCRIPTION =
  "Simplr answers, qualifies, and books tours for every rental inquiry, day or night, so residential property managers never lose a lead to a missed call."

export const metadata: Metadata = {
  // absolute: the root layout's "%s | Simplr" template would otherwise double the name.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { siteName: "Simplr", title: TITLE, description: DESCRIPTION, type: "website" },
}

export default function SimplrLandingHome() {
  return (
    <>
      <IconSprite />
      {/* The source index.html has no <main> landmark at all — added here is a pixel-invisible
          a11y fix (Lighthouse: "no main landmark"): <main> is display:block with no styling hooks
          in site.css, so nothing renders differently. Footer stays outside, as its own <footer>
          landmark. */}
      <main>
        <Hero />
        <Stats />
        <Cold />
        <Features />
        <Answered />
        <Impact />
        <Everyone />
        <Process />
        <Faq />
        <Contact />
      </main>
      <Footer />
    </>
  )
}
