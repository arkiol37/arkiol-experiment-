// src/lib/openai.ts
// Safe OpenAI client — returns clear errors when API key not configured.
import 'server-only';
import { detectCapabilities } from '@arkiol/shared';

let _openai: any = null;

export function getOpenAIClient(): any {
  if (!detectCapabilities().ai) {
    throw new Error('AI features unavailable: OPENAI_API_KEY not configured. Add it to your Vercel environment variables.');
  }
  if (!_openai) {
    const OpenAI = require('openai').default ?? require('openai');
    _openai = new OpenAI({
      apiKey:       process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORG_ID,
      maxRetries:   3,
      timeout:      90_000,
    });
  }
  return _openai;
}

export const openai: any = new Proxy({}, {
  get(_target, prop: string) { return (getOpenAIClient() as any)[prop]; },
});

export type ChatMessage = any;

export async function chat(
  messages: ChatMessage[],
  options: { model?: string; temperature?: number; max_tokens?: number; response_format?: any } = {}
): Promise<string> {
  const response = await getOpenAIClient().chat.completions.create({
    model:       options.model ?? 'gpt-4o',
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens:  options.max_tokens ?? 2048,
    ...(options.response_format ? { response_format: options.response_format } : {}),
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error(`OpenAI returned empty content. finish_reason: ${response.choices[0]?.finish_reason}`);
  return content;
}

export async function chatJSON(messages: ChatMessage[], options: any = {}): Promise<unknown> {
  const raw = await chat(messages, { ...options, response_format: { type: 'json_object' }, temperature: options.temperature ?? 0.3 });
  try { return JSON.parse(raw); }
  catch { throw new Error(`OpenAI returned invalid JSON: ${raw.slice(0, 200)}`); }
}

export async function chatVision(imageSource: string, textPrompt: string, options: any = {}): Promise<string> {
  const imageContent: any = { type: 'image_url', image_url: { url: imageSource, detail: 'low' } };
  const response = await getOpenAIClient().chat.completions.create({
    model: options.model ?? 'gpt-4o',
    temperature: options.temperature ?? 0.3,
    max_tokens: options.max_tokens ?? 800,
    messages: [{ role: 'user', content: [imageContent, { type: 'text', text: textPrompt }] }],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('chatVision: empty response');
  return content;
}

export async function chatVisionJSON(imageSource: string, textPrompt: string, options: any = {}): Promise<unknown> {
  const rawText = await chatVision(imageSource, textPrompt, options);
  const clean = rawText.replace(/^```(?:json)?\n?|\n?```$/gm, '').trim();
  try { return JSON.parse(clean); }
  catch { throw new Error(`chatVisionJSON: invalid JSON in response: ${clean.slice(0, 200)}`); }
}
