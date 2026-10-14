export type DemoSpeaker = "ai" | "caller";

export type DemoLine = {
  speaker: DemoSpeaker;
  text: string;
  file: string;
  check?: string;
};

export const AUDIO_BASE_PATH = "/landing/audio/";

export const SCRIPT: DemoLine[] = [
  {
    speaker: "ai",
    text: "Thanks for calling Parkview Apartments, this is the leasing assistant — how can I help you today?",
    file: "01.mp3",
  },
  {
    speaker: "caller",
    text: "Hey, um, I saw the two-bedroom listing online, is it still available?",
    file: "02tenant.mp3",
    check: "unit",
  },
  {
    speaker: "ai",
    text: "It is — happy to help you check it out. Can I grab a couple quick details first? What's your ideal move-in date?",
    file: "03ai.mp3",
  },
  {
    speaker: "caller",
    text: "Probably early next month, maybe the first or so.",
    file: "04tenant.mp3",
    check: "movein",
  },
  {
    speaker: "ai",
    text: "Got it. And what's your budget range for monthly rent?",
    file: "05ai.mp3",
  },
  {
    speaker: "caller",
    text: "Around sixteen hundred, maybe a bit more if it's nice.",
    file: "06tenant.mp3",
    check: "budget",
  },
  {
    speaker: "ai",
    text: "That works for our two-bedrooms. Last thing — any pets?",
    file: "07ai.mp3",
  },
  {
    speaker: "caller",
    text: "Yeah, I've got a small dog.",
    file: "08tenant.mp3",
    check: "pets",
  },
  {
    speaker: "ai",
    text: "No problem, this building's pet-friendly. Can I get your name and a callback number, just in case we get cut off?",
    file: "09ai.mp3",
  },
  {
    speaker: "caller",
    text: "Sure — it's Sarah, and it's five-five-five, oh one four two.",
    file: "10tenant.mp3",
    check: "contact",
  },
  {
    speaker: "ai",
    text: "Perfect, Sarah. That unit fits your budget, your timeline, and the building takes pets — so let's get you in to see it. Does Thursday afternoon work for a tour?",
    file: "11ai.mp3",
  },
  {
    speaker: "caller",
    text: "Yeah, that could work.",
    file: "12tenant.mp3",
  },
  {
    speaker: "ai",
    text: "Great, I've got you down for Thursday at 3 PM, and I'm sending a text confirmation right now. Anything else I can help with?",
    file: "13ai.mp3",
    check: "tour",
  },
  {
    speaker: "caller",
    text: "No, that's it — thanks!",
    file: "14tenant.mp3",
  },
  {
    speaker: "ai",
    text: "Of course. Talk soon.",
    file: "15ai.mp3",
  },
];

export const CHECKLIST_ITEMS = [
  { key: "unit", label: "Unit type" },
  { key: "movein", label: "Move-in date" },
  { key: "budget", label: "Budget range" },
  { key: "pets", label: "Pet policy" },
  { key: "contact", label: "Contact info" },
  { key: "tour", label: "Tour booked" },
] as const;
