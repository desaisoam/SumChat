import { NextRequest } from "next/server";
import { systemPrompt } from "../../../../lib/llm/prompt";

export async function POST(_req: NextRequest) {
  try {
    const model = process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview";
    const voice = process.env.OPENAI_REALTIME_VOICE || "verse";
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY is not set." }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }

    // Create ephemeral key using raw REST (compatible with older SDK versions)
    const resp = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        model,
        voice,
        instructions: systemPrompt,
        modalities: ["audio", "text"],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(
        JSON.stringify({ error: `Failed to create session: ${resp.status} ${text}` }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }

    const session = await resp.json();
    const payload = {
      client_secret: session?.client_secret?.value,
      model: session?.model ?? model,
      voice: session?.voice ?? voice,
    };
    if (!payload.client_secret) {
      return new Response(
        JSON.stringify({ error: "Session created but missing client_secret" }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error: any) {
    console.error("/api/realtime/session error", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Unexpected error" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}
