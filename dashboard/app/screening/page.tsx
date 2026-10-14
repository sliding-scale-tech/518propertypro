"use client";

import { BuiltInQuestions, ScreeningQuestions } from "@/components/screening-questions";

export default function ScreeningPage() {
  return (
    <div className="space-y-7 pb-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Screening</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
          Extra questions Sarah asks every leasing caller, on top of the five she always asks —
          unit type, move-in date, budget, pets, and contact details. Mark one as a requirement
          and it becomes a real pass/fail rule, applied by the same code that checks rent and
          availability. The AI asks and reports; it never decides who qualifies.
        </p>
      </header>

      <BuiltInQuestions />
      <ScreeningQuestions />
    </div>
  );
}
