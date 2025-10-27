import OpenAI from "openai";
import { NextRequest } from "next/server";
import { systemPrompt } from "../../../lib/llm/prompt";

let cachedClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey });
  }
  return cachedClient;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const engagement = typeof body?.engagement === "number" ? body.engagement : undefined;

    console.log("/api/chat payload engagement=", engagement);

    const client = getOpenAIClient();
    if (!client) {
      return new Response(
        JSON.stringify({
          error: "OPENAI_API_KEY is not set. Add it to .env.local or provide a custom model backend.",
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }

    const chatMessages = messages
      .map((msg: any) => {
        if (!msg || typeof msg !== "object") return null;
        const role = msg.role === "assistant" ? "assistant" : "user";
        const content = typeof msg.content === "string" ? msg.content : "";
        return { role, content };
      })
      .filter(Boolean) as { role: "user" | "assistant"; content: string }[];

    const hiddenLine = engagement != null ? `\n\nNormalized engagement score (0-1): ${engagement.toFixed(3)}` : "";

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: [
        { role: "system", content: systemPrompt + hiddenLine },
        ...chatMessages,
      ],
    });

    const text = completion.choices?.[0]?.message?.content ?? "";

    return new Response(
      JSON.stringify({ role: "assistant", content: text }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch (error: any) {
    console.error("/api/chat error", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Unexpected error" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}
