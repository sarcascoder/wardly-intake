import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

/**
 * Provider strategy — optimised for deployable, low-latency, high-headroom
 * behaviour both locally and on Vercel.
 *
 * Two stages, decoupled because their needs are opposite:
 *
 *  - chatModel        — called every turn. Latency + daily token budget
 *                       matter most. Quality of narrative reasoning matters
 *                       less because slot-filling is structured.
 *
 *  - synthesisModel   — called ONCE per session at the end to write the
 *                       clinical brief. Latency is a non-issue. Narrative
 *                       reasoning quality matters most.
 *
 * Default mapping:
 *   GROQ_API_KEY  → chat      = llama-3.1-8b-instant  (500k TPD, ~600ms TTFT)
 *   GOOGLE        → synthesis = gemini-2.5-pro        (different quota pool;
 *                                                      called once, so tight
 *                                                      RPM is fine)
 *
 * Fallbacks: if only one provider is set, the same provider is used for both
 * stages with the best-available model. If OLLAMA_BASE_URL is set, the local
 * model wins over both (great for dev, won't work on Vercel).
 */

function ollamaProvider() {
  const baseURL = process.env.OLLAMA_BASE_URL;
  if (!baseURL) return null;
  // Ollama exposes an OpenAI-compatible endpoint at <baseURL>/v1
  const url = baseURL.replace(/\/$/, '');
  const fullUrl = url.endsWith('/v1') ? url : `${url}/v1`;
  return createOpenAICompatible({ name: 'ollama', baseURL: fullUrl });
}

export function chatModel(): LanguageModel {
  const ollama = ollamaProvider();
  if (ollama) {
    return ollama.chatModel(process.env.OLLAMA_MODEL ?? 'qwen2.5:7b');
  }
  if (process.env.GROQ_API_KEY) {
    // meta-llama/llama-4-scout-17b-16e-instruct — Llama 4 MoE, 1M TPD on
    // Groq's free tier (10× llama-3.3-70b's 100k cap), and reliably pairs
    // tool calls with text replies (unlike gpt-oss-20b which stops without
    // text after a tool call). Best balance of headroom + discipline for
    // bursty voice-mode use.
    return groq('meta-llama/llama-4-scout-17b-16e-instruct');
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return google('gemini-2.0-flash-lite');
  }
  return google('gemini-2.0-flash-lite');
}

export function synthesisModel(): LanguageModel {
  const ollama = ollamaProvider();
  if (ollama) {
    return ollama.chatModel(
      process.env.OLLAMA_SYNTHESIS_MODEL ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
    );
  }
  if (process.env.GROQ_API_KEY) {
    // meta-llama/llama-4-scout-17b-16e-instruct for synthesis — verified to
    // accept the strict ClinicalBriefSchema. (Maverick's response_format
    // validator is stricter and rejects optional/nullable fields.) Same
    // model as chat — chat's per-turn token use is tiny vs synthesis's
    // single big call, so they share the 1M TPD bucket comfortably.
    return groq('meta-llama/llama-4-scout-17b-16e-instruct');
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return google('gemini-2.5-pro');
  }
  return google('gemini-2.5-pro');
}

export function activeProvider(): 'ollama' | 'groq' | 'google' {
  if (process.env.OLLAMA_BASE_URL) return 'ollama';
  if (process.env.GROQ_API_KEY) return 'groq';
  return 'google';
}
