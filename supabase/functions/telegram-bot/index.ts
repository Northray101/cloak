import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_TOKEN  = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? ""; // optional but recommended
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_HISTORY = 20; // messages (pairs) to keep per session

async function sendTelegram(chatId: number | string, text: string) {
  // Telegram max message length is 4096 chars; split if needed
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));

  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: "Markdown" }),
    });
  }
}

async function getOrCreateSession(
  db: ReturnType<typeof createClient>,
  platformId: string,
): Promise<{ id: string; history: { role: string; message: string }[] }> {
  const { data, error } = await db
    .from("messaging_sessions")
    .select("id, history")
    .eq("platform", "telegram")
    .eq("platform_id", platformId)
    .single();

  if (data) return data as { id: string; history: { role: string; message: string }[] };
  if (error?.code !== "PGRST116") throw error; // unexpected error

  const { data: created, error: createErr } = await db
    .from("messaging_sessions")
    .insert({ platform: "telegram", platform_id: platformId, history: [] })
    .select("id, history")
    .single();

  if (createErr) throw createErr;
  return created as { id: string; history: { role: string; message: string }[] };
}

async function saveHistory(
  db: ReturnType<typeof createClient>,
  sessionId: string,
  history: { role: string; message: string }[],
) {
  // Trim to last MAX_HISTORY messages before saving
  const trimmed = history.slice(-MAX_HISTORY);
  await db.from("messaging_sessions").update({ history: trimmed }).eq("id", sessionId);
}

async function callChatMessage(
  message: string,
  chatHistory: { role: string; message: string }[],
): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "apikey": SERVICE_KEY,
    },
    body: JSON.stringify({ message, chat_history: chatHistory }),
    signal: AbortSignal.timeout(55_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`chat-message ${res.status}: ${err.slice(0, 200)}`);
  }

  const json = await res.json();
  return json.text ?? "Sorry, I couldn't generate a response.";
}

serve(async (req) => {
  // Validate secret token if configured
  if (TELEGRAM_SECRET) {
    const header = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (header !== TELEGRAM_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let update: {
    message?: {
      chat: { id: number };
      from?: { id: number };
      text?: string;
    };
  };

  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Only handle text messages
  const msg = update?.message;
  if (!msg?.text || !msg?.chat?.id) {
    return new Response("ok", { status: 200 });
  }

  const chatId     = msg.chat.id;
  const userText   = msg.text.trim();

  // Ignore Telegram bot commands other than /start
  if (userText.startsWith("/") && !userText.startsWith("/start")) {
    return new Response("ok", { status: 200 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // Show typing indicator (fire-and-forget)
    fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });

    if (userText === "/start") {
      await sendTelegram(chatId,
        "Hey, I'm *Cloak* — an AI assistant. Ask me anything."
      );
      return new Response("ok", { status: 200 });
    }

    const session = await getOrCreateSession(db, String(chatId));
    const reply   = await callChatMessage(userText, session.history);

    // Append to history
    const newHistory = [
      ...session.history,
      { role: "USER", message: userText },
      { role: "CHATBOT", message: reply },
    ];
    await saveHistory(db, session.id, newHistory);

    await sendTelegram(chatId, reply);
  } catch (e) {
    console.error("telegram-bot error:", e instanceof Error ? e.message : String(e));
    await sendTelegram(chatId, "Something went wrong. Try again in a moment.");
  }

  return new Response("ok", { status: 200 });
});
