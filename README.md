# Wardly · Pre-visit clinical intake

A working **clinical-intake agent** that conducts a pre-visit conversation with a patient and emits a **structured clinical brief (CC, HPI/OLDCARTS, ROS, red flags)** for the clinician.

> **Take-home for the Wardly Founding Engineer role.** Built in ~5 hours.
> **Submission demo:** [Loom — 5 min walkthrough](#) *(record before sending)*

---

## What this is, in one sentence

A two-pane web app where a patient (you) talks — by **chat or voice** — to an empathetic AI intake assistant; the right pane shows their **chart paper assembling itself in real time** as the agent records each clinical fact via tool calls; at the end a separate model synthesises a clinician-ready brief.

```
┌──────────────────────────────────────────┐  ┌──────────────────────────────┐
│  Conversation                            │  │  Live intake chart           │
│                                          │  │  CC: "sharp chest pain..."   │
│  Agent: That sounds rough — when did     │  │  HPI · OLDCARTS              │
│         the pain start?                  │  │   ● Onset · 2 days ago       │
│  Patient: Two days ago, on the stairs.   │  │   ● Location · mid-chest …   │
│  Agent: I'm noting that. Does it travel  │  │   ○ Severity                 │
│         anywhere when it hurts?          │  │  Red flags · 1 (moderate)    │
└──────────────────────────────────────────┘  └──────────────────────────────┘
                                                            │
                                                            ▼
                                              Pre-visit clinical brief
                                              (markdown + JSON · triage)
```

---

## Quick start

```bash
pnpm install
cp .env.local.example .env.local
# Paste your free Groq key from https://console.groq.com/keys
pnpm dev                                # → http://localhost:3000
```

**Get a free Groq API key** in 30 seconds at https://console.groq.com/keys — no credit card. Free tier:

| Stage | Model | Limit |
|---|---|---|
| Conversation | `openai/gpt-oss-20b` | 200,000 tokens/day, ~600 ms TTFT |
| Brief synthesis | `meta-llama/llama-4-scout-17b-16e-instruct` | Separate quota, called once per session |

```dotenv
# .env.local
GROQ_API_KEY=gsk_...
```

The provider is auto-selected at runtime. If you'd rather use Google Gemini or a local Ollama model, see `.env.local.example` — uncommenting `GOOGLE_GENERATIVE_AI_API_KEY` or `OLLAMA_BASE_URL` switches the active provider with no code change.

### Deploy to Vercel

```bash
vercel deploy
# Add GROQ_API_KEY in the Vercel project's Environment Variables.
# Re-deploy. That's it.
```

Optional eval suite:

```bash
pnpm dev          # in one shell
pnpm eval         # in another — replays 3 patient personas, asserts on slots
```

---

## Why this design

The take-home prompt said *"less focused on polish, more on how you approach the problem — especially how the conversation flows and how well the output is structured for a clinician."* So the emphasis throughout is **conversation design + output trust**, not UI flourish.

The two engineering decisions that drove everything else:

### 1. Slot-filling tools, not transcript-parsing

A naïve clinical agent would take the whole transcript at the end and ask the LLM to "extract the structured brief." That fails the moment the model hallucinates or omits details. Instead:

- The conversational LLM is given **typed tools** (`record_cc`, `record_hpi_oldcarts`, `record_ros`, `flag_red_flag`, …) and is **required by the system prompt to call them in parallel with its conversational reply** every turn.
- The tools' `execute` handlers mutate an `IntakeState` keyed by `sessionId`.
- The **brief is generated from the structured state, not the raw transcript** — so the brief is grounded in what the agent actually captured, not what it can re-derive.
- The agent calls `get_intake_status` to ask the server what's still missing — it never has to remember slot-by-slot, and the loop terminates only when CC + most OLDCARTS + ≥2 ROS systems + red-flag screen + meds/allergies are present.

This pattern (a) gives the clinician a deterministic record, (b) makes the agent *adaptive* (next-question selection is gap-driven), and (c) makes the system inspectable — the sidebar UI literally renders the slot store.

### 2. CC-driven, not checklist-driven, conversation

A bad intake bot reads all 14 ROS systems at every patient. A good one picks 2–4 systems based on the chief complaint:

| CC | ROS systems probed |
|---|---|
| Chest pain | cardiovascular, respiratory, GI, constitutional |
| Headache | neurological, eyes/ENT, constitutional |
| Abdominal pain | GI, GU, constitutional |
| Cough | respiratory, ENT, constitutional, CV |
| Back pain | MSK, neurological, GU |

This is encoded in the system prompt with explicit examples + a "pick what's clinically informative" instruction rather than a hard mapping — the agent should be able to handle CCs that aren't in the table. Red-flag screens are similarly CC-conditioned (chest pain → exertional onset, radiation, diaphoresis; headache → thunderclap, focal deficit, neck stiffness).

### 3. Two-model split, decoupled by job

- **Conversation:** **`openai/gpt-oss-20b` on Groq** — sub-second TTFT (matters for voice mode), reliable tool calling (it's OpenAI-trained and stays disciplined about JSON-Schema'd tool inputs), 200k tokens/day on free tier. Plenty of headroom for hands-free testing without rate-limit stalls.
- **Final brief synthesis:** **`meta-llama/llama-4-scout-17b-16e-instruct` on Groq** — Llama 4 MoE with strong instruction-following for narrative writing. Different quota bucket from the chat path, called once per session, so brief generation never contends with conversation budget.

Both reach via `@ai-sdk/groq` directly. Single env var, deploys to Vercel cleanly.

**Alternatives I tested and rejected:**
- *Gemini 2.5 Flash for chat:* worked well but tighter free-tier RPM (20) caused stalls under bursty voice-mode use. Kept as a fallback (auto-detected via `GOOGLE_GENERATIVE_AI_API_KEY`).
- *Llama 3.3 70B for chat:* best tool calling but only 100k TPD on free tier — exhausts faster than 20b. Kept as the synthesis backup if Llama 4 is unavailable.
- *Llama 3.1 8B Instant:* 500k TPD looked attractive but Groq's strict tool-call validator rejects 8B's tool calls too often.
- *gpt-oss-120b for synthesis:* its strict `response_format` validator requires every property in `required` (rejects Zod's nullable/defaulted fields). Llama 4 Scout is more lenient.
- *Local Ollama:* great for dev (no rate limits), supported via `OLLAMA_BASE_URL`, but doesn't deploy to Vercel (serverless functions can't reach `localhost:11434`).
- *Claude Sonnet 4.6:* highest clinical quality but the take-home target was a free path.
- *Vapi inbound phone calls:* ~60 min of telephony plumbing for ~10% extra signal. Architecture is transport-agnostic — swapping in Vapi is a webhook handler change, not a refactor.

### Schema design — provider-tolerant tool inputs

Different LLMs serialise arrays differently. Llama models often emit comma-separated strings (`"sweaty, nauseated"`) where Gemini/GPT emit JSON arrays. To keep tool calls robust across providers, all array-typed tool inputs use:

```ts
const stringOrArray = z.union([z.array(z.string()), z.string()]);
```

with a `toStringArray()` coercer in every `execute()` that splits on commas/semicolons. This avoids the most common cross-provider failure mode (tool-call validation rejection) without sacrificing the structured output guarantee on the server side.

Empty-schema tools (`get_intake_status`, `get_booking_status`) were removed entirely after gpt-oss-style models started emitting phantom keys that strict validators reject. The state is auto-injected into the system prompt every turn instead — same effect, more robust.

---

## Architecture

```
                                  ┌───────────────────────────────┐
                                  │  Browser                      │
                                  │  ┌─────────────────────────┐  │
  ┌──────────┐                    │  │ <ChatMessage> stream    │  │
  │ Web      │  STT/TTS  (free)   │  │ <IntakeSidebar> live    │  │
  │ Speech   │──────────────────► │  │ <BriefView> markdown    │  │
  │ API      │                    │  └─────────────────────────┘  │
  └──────────┘                    │            │ useChat          │
                                  │            ▼                  │
                                  └────────────┼──────────────────┘
                                               │ /api/chat (UIMessageStream)
                                               ▼
            ┌─────────────────────────────────────────────────────┐
            │  Next.js route handler /api/chat                    │
            │   streamText({                                       │
            │     model: google('gemini-2.5-flash'),               │
            │     system: clinical-intake prompt + state block,    │
            │     tools: buildIntakeTools(sessionId),              │
            │     stopWhen: stepCountIs(8),                        │
            │   })                                                 │
            └────────────────────┬────────────────────────────────┘
                                 │ tool.execute mutates
                                 ▼
                  ┌─────────────────────────────┐
                  │ session-store (in-process)   │
                  │  Map<sessionId, IntakeState> │
                  └────────────┬─────────────────┘
                               │ (read on demand)
                               ▼
            ┌─────────────────────────────────────────────────────┐
            │  /api/brief                                         │
            │   generateObject({                                   │
            │     model: google('gemini-2.5-pro'),                 │
            │     schema: ClinicalBriefSchema (Zod),               │
            │     prompt: <IntakeState JSON>                       │
            │   })                                                 │
            └─────────────────────────────────────────────────────┘
```

| File | Role |
|---|---|
| `src/lib/clinical-schema.ts` | Zod schemas: `IntakeState`, `OldcartsSchema`, `RosFindingSchema`, `ClinicalBriefSchema` |
| `src/lib/system-prompt.ts` | The clinical conversation policy — phases, OLDCARTS, CC-driven ROS, red-flag rules, tool-usage contract |
| `src/lib/intake-tools.ts` | The 9 slot-filling tools — typed Zod inputs, server-side execute |
| `src/lib/session-store.ts` | In-process session store keyed by `sessionId`, `globalThis`-anchored to survive HMR |
| `src/lib/use-voice.ts` | Web Speech API hook — STT + TTS, browser-native, free |
| `src/app/api/chat/route.ts` | `streamText` + tools loop, injects compact state-summary into the system prompt each turn |
| `src/app/api/brief/route.ts` | `generateObject` against `ClinicalBriefSchema`, fed the structured state (not the transcript) |
| `src/app/api/intake-status/route.ts` | `GET` snapshot of `IntakeState` for the live sidebar |
| `src/app/api/reset/route.ts` | `POST` to drop a session and start fresh |
| `src/app/page.tsx` | The two-pane UI (conversation + chart) with voice and brief modal |
| `src/components/*` | Presentational components (chat-message, intake-sidebar, brief-view) |
| `evals/personas.ts` | 3 scripted patients (chest pain, migraine, RUQ abdominal pain) |
| `evals/run.ts` | Replays personas against the live API, asserts on final state |

---

## The clinical brief

The end product. Generated by feeding the **structured `IntakeState`** (not the raw transcript) to Gemini 2.5 Pro with a Zod schema:

```ts
ClinicalBrief = {
  patient: { name, age, sex },
  cc: string,                          // patient verbatim, ≤1 sentence
  hpi: {
    narrative: string,                 // 3–6 sentence clinical paragraph
    oldcarts: { onset, location, …, severity, associatedSymptoms }
  },
  ros: {
    systems: RosFinding[],             // only systems probed
    notAssessed: RosSystem[]           // honest about what wasn't asked
  },
  redFlags: { description, severity }[],
  pertinentNegatives: string[],        // explicit denials matter clinically
  allergies, currentMedications, pastMedicalHistory,
  recommendedTriage: 'emergency' | 'urgent' | 'routine' | 'self-care',
  completenessScore: 0–1,              // self-assessed honesty signal
  intakeDurationSeconds: number,
}
```

Three deliberate calls in the schema design:

- **`notAssessed`** is explicit. A doctor needs to know what *wasn't* asked — pretending the intake covered everything is worse than admitting gaps.
- **`pertinentNegatives`** is a top-level field. Real clinicians read these. They're not noise.
- **`completenessScore`** is a self-assessed honesty signal — it lets a clinician decide whether to skim or to re-interview.

---

## Conversation design rules (encoded in the system prompt)

Excerpts:

> *One question per turn. Two only if very tightly related.*
> *Mirror the patient's language. If they say "tummy", you can say "tummy" — don't translate to "abdomen" out loud.*
> *Acknowledge before probing.*
> *Don't read a checklist — choose the next question based on what is most clinically informative given what's already been said.*
> *Never diagnose, never prescribe, never offer reassurance about safety of symptoms.*
> *If the patient describes a clear emergency, warmly recommend emergency services AND continue to capture what you can without panicking them.*

The full prompt (~1200 tokens) is in `src/lib/system-prompt.ts`.

---

## What I'd do next, given more time

These are deliberate cuts from the 5-hour budget — *not* "I forgot":

| Cut | What it would do | Effort |
|---|---|---|
| **Real telephony** (Vapi inbound) | Patient dials a phone number, agent answers, brief lands in clinician's inbox at end of call | ~45 min |
| **Persistent storage** (Postgres / Upstash) | IntakeState survives server restarts; multi-region; clinician dashboard | ~2 h |
| **Clinician auth + dashboard** | Clinicians log in, see a queue of pre-visit briefs, can request follow-up questions | ~3 h |
| **Eval-driven prompt iteration** | Add LLM-as-judge to evals (does the HPI narrative read like a clinician wrote it?), iterate prompt | ~2 h |
| **Bigger persona library + adversarial cases** | Vague patients, patients who minimise, patients in crisis, multilingual | ~2 h |
| **Configurable intake templates** | Per-clinic ROS depth, custom red-flag rules, specialty-specific (peds, OB, mental health) | ~3 h |
| **Patient-facing edits/confirmations** | Patient sees the chart side too; can correct misheard items | ~1 h |
| **Latency optimisation for voice** | Stream agent text into TTS as it generates instead of waiting for end-of-message | ~1 h |
| **PHI handling + HIPAA-ready posture** | BAA-covered providers, audit logging, retention policy | non-trivial |

---

## Trying the demo

1. Open http://localhost:3000.
2. Click **Begin intake** (or tap mic if your browser supports speech recognition — Chrome/Edge/Safari do).
3. Try one of the seeded scenarios on the welcome screen, or describe any symptom in your own words.
4. Watch the right-hand chart fill in real time as the agent captures details.
5. When the chip says **intake complete** (or whenever you've shared enough), click **Generate brief**.
6. The brief opens in a modal — toggle between **Brief** (clinician view, markdown) and **JSON** (raw structure). **Copy markdown** drops it on the clipboard for a chart system.

For the Loom: I'd recommend the chest-pain scenario — it best demonstrates adaptive ROS selection and red-flag detection (exertional onset → CV ROS, diaphoresis → moderate red flag → triage `urgent`).

---

## Tech

- **Next.js 16** (App Router, Turbopack)
- **AI SDK v6** + **`@ai-sdk/google`** (Gemini 2.5 Flash & Pro)
- **Zod 4** for schemas + tool input validation
- **TypeScript** strict
- **Tailwind 4** with a custom clinical-editorial theme (Fraunces · IBM Plex Sans · JetBrains Mono)
- **Web Speech API** for browser-native STT + TTS (no extra services)
- `tsx` for the eval runner

No backend service, no database, no analytics — fits in `pnpm dev`.

---

## Notes for the reviewer

- I optimised for *demonstrating problem decomposition*, not *finishing every feature*. The slot-filling pattern, the two-model split, and the structured-output-from-structured-state pipeline are the parts I'd defend in an interview.
- I deliberately did not lean on any heavy UI library — the look is built from a small token system in `globals.css`. It should feel like a careful editorial product, not a generic chatbot.
- The system prompt is plain English on purpose: a clinical product manager who is not an engineer should be able to read it, edit it, and own the conversation policy without touching code.
- Everything is `Reset`-able from the header — useful if you want to record multiple takes for the Loom.
