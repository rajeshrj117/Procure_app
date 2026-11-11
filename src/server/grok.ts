type GrokMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

export function grokConfigured() {
  return Boolean(process.env.GROK_API_KEY || process.env.XAI_API_KEY);
}

export function grokModel() {
  return process.env.GROK_MODEL || process.env.XAI_MODEL || "grok-3";
}

export async function grokComplete(messages: GrokMessage[], opts?: { temperature?: number; maxTokens?: number }) {
  const key = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  if (!key) return { text: null as string | null, error: null as string | null, configured: false };
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: grokModel(),
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.maxTokens ?? 1200,
        messages,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      const err = (await res.text()).slice(0, 400);
      return { text: null, error: `Grok request failed (${res.status}). ${err}`, configured: true };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text?.trim()) return { text: null, error: "Grok returned an empty response.", configured: true };
    return { text: text.trim(), error: null, configured: true };
  } catch (error) {
    return {
      text: null,
      error: error instanceof Error ? error.message : "Grok is unavailable.",
      configured: true,
    };
  }
}

export function parseJsonBlock(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const arr = raw.indexOf("[");
  const index = start === -1 ? arr : arr === -1 ? start : Math.min(start, arr);
  if (index === -1) return null;
  const slice = raw.slice(index);
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    const endObj = slice.lastIndexOf("}");
    const endArr = slice.lastIndexOf("]");
    const end = Math.max(endObj, endArr);
    if (end === -1) return null;
    try {
      return JSON.parse(slice.slice(0, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}
