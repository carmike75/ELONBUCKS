import "dotenv/config";
import path from "node:path";
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./systemPrompt";

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_HISTORY_MESSAGES = 20;

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[jsystem-voice-agent] WARNING: ANTHROPIC_API_KEY is not set. /api/chat will fail until it is configured (see .env.example)."
  );
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const systemPrompt = buildSystemPrompt();

type ChatMessage = { role: "user" | "assistant"; content: string };

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function sanitizeHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (m): m is ChatMessage =>
        m &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length > 0 &&
        m.content.length < 4000
    )
    .slice(-MAX_HISTORY_MESSAGES);
}

app.post("/api/chat", async (req, res) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) {
      res.status(400).json({ error: "Missing 'message' string in request body." });
      return;
    }
    if (message.length > 4000) {
      res.status(400).json({ error: "Message too long." });
      return;
    }

    const history = sanitizeHistory(req.body?.history);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: systemPrompt,
      messages: [...history, { role: "user", content: message }],
    });

    const reply = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    res.json({ reply });
  } catch (err) {
    console.error("[jsystem-voice-agent] /api/chat error:", err);
    res.status(502).json({
      error:
        "The assistant is temporarily unavailable. Please try again shortly, or contact Giken Kaihatsu directly.",
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[jsystem-voice-agent] listening on http://localhost:${PORT}`);
});
