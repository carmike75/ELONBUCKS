# J System Assistant

A bilingual (English / Japanese) AI voice + chat agent for **J System (Jシステム)**, Giken Kaihatsu Co., Ltd.'s (技建開発株式会社) infrared bridge-inspection technology. Built from the official product brochure so the agent only ever speaks from real, sourced facts.

## What this is

- **Knowledge-locked assistant.** All facts the agent can state live in [`knowledge/jsystem-knowledge.json`](knowledge/jsystem-knowledge.json), transcribed and bilingually structured from the J System brochure (certifications, detection performance, survey process, damage classification, cost/time comparison vs. conventional inspection methods, adoption history, and contact details).
- **Strict scope guard.** The system prompt ([`src/systemPrompt.ts`](src/systemPrompt.ts)) instructs the model to answer *only* questions about J System / bridge infrared inspection, to politely decline anything else, and to resist prompt-injection attempts to reveal its instructions or the raw knowledge file.
- **Bilingual by default.** The agent detects whether the user is writing/speaking in English or Japanese and responds in kind, in natural business Japanese or English — no separate deployments needed.
- **Voice + chat in one widget.** The browser frontend ([`public/`](public/)) offers a chat bubble UI plus a microphone button (Web Speech API `SpeechRecognition`) and spoken replies (`SpeechSynthesis`), so it behaves like a voice agent without requiring any telephony infrastructure.

## Architecture

```
Browser (public/)             Node/Express (src/)                 Anthropic API
┌─────────────────────┐       ┌───────────────────────────┐       ┌──────────────┐
│ index.html/app.js    │  ───► │ POST /api/chat            │  ───► │ Claude        │
│  - chat UI           │       │  - loads system prompt    │       │ (claude-sonnet│
│  - mic (STT)         │       │    + knowledge base       │       │  -5 by default)│
│  - speech (TTS)      │ ◄───  │  - forwards conversation   │ ◄───  │               │
│  - EN/JA toggle       │       │    history                 │       └──────────────┘
└─────────────────────┘       └───────────────────────────┘
```

The knowledge base is injected into the system prompt on every request — there is no separate retrieval step needed because the brochure is small enough to fit in full context. If the brochure grows, swap `renderKnowledgeBase()` in `src/knowledge.ts` for a retrieval step without touching the guardrails in `systemPrompt.ts`.

## Setup

```bash
cd jsystem-voice-agent
npm install
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
npm run dev      # http://localhost:3000, auto-reloads on change
# or: npm run build && npm start
```

Open `http://localhost:3000` in **Chrome or Edge** (best Web Speech API support) to use both chat and voice. Firefox/Safari support for `SpeechRecognition` is limited or absent — the widget still works as text chat there, but the mic button will be disabled with an explanatory tooltip.

## Updating the knowledge base

Edit `knowledge/jsystem-knowledge.json` directly — it's plain, human-readable bilingual JSON, one field pair (`_en` / `_ja`) per fact. `src/knowledge.ts` flattens it into the text block that gets embedded in the system prompt; no other code needs to change when you add or correct a fact. Keep new facts sourced from official Giken Kaihatsu material only, so the "only answer from the brochure" guarantee stays true.

## Guardrails in place

1. **Scope lock** — the model is told its only valid subject matter is J System / the knowledge base; off-topic questions get a polite redirect, in the user's language.
2. **Anti-injection** — attempts to get the model to ignore instructions, reveal its system prompt, dump the raw knowledge file, or roleplay as an unrestricted assistant are treated as out-of-scope requests, not obeyed.
3. **No hallucination fallback** — if a question isn't covered by the brochure (e.g., a specific project quote), the agent says so honestly and hands off to Giken Kaihatsu's real contact details (phone/email/website) rather than inventing an answer.
4. **Server-side input limits** — message length and conversation history length are capped in `src/server.ts` to keep requests bounded.

## Extending to a real phone/telephony voice agent

This implementation uses the browser's built-in Web Speech API so it runs anywhere with zero extra credentials. To turn it into a true inbound/outbound phone voice agent, keep `src/systemPrompt.ts` and `src/knowledge.ts` as-is and swap the transport layer for a telephony + speech stack, e.g.:

- **Telephony:** Twilio Voice (or similar) to receive/place calls and stream audio.
- **STT:** Twilio's built-in transcription, or a dedicated speech-to-text API with Japanese support.
- **TTS:** A neural TTS provider with natural Japanese and English voices (e.g., ElevenLabs, Google Cloud TTS, Amazon Polly).

The `/api/chat` endpoint's request/response shape (`{ message, history } -> { reply }`) is transport-agnostic, so it can be reused as-is behind a telephony bridge.

## Environment variables

See [`.env.example`](.env.example):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-5` | Model used for chat completions |
| `PORT` | No | `3000` | HTTP port for the Express server |
