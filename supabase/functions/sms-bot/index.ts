import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts";

const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_HISTORY  = 10; // SMS sessions stay leaner
const SMS_MAX_CHARS = 1600; // Twilio concatenates up to 10 segments (160×10)

// ── Twilio signature validation ───────────────────────────────────────────────
// https://www.twilio.com/docs/usage/webhooks/webhooks-security
async function validateTwilioSignature(req: Request, body: string): Promise<boolean> {
  if (!TWILIO_AUTH_TOKEN) return true; // skip in dev if not set

  const url       = req.url;
  const signature = req.headers.get("X-Twilio-Signature") ?? "";

  // Build the validation string: URL + sorted params concatenated
  const params = new URLSearchParams(body);
  const sortedKeys = [...params.keys()].sort();
  const paramString = sortedKeys.map((k) => k + params.get(k)).join("");
  const toSign = url + paramString;

  const computed = await hmac("sha1", TWILIO_AUTH_TOKEN, toSign, "utf8", "base64");
  return computed === signature;
}

function twimlResponse(text: string): Response {
  // Truncate gracefully if over SMS limit
  const safe = text.length > SMS_MAX_CHARS ? text.slice(0, SMS_MAX_CHARS - 3) + "..." : text;
  // Strip markdown formatting that doesn't render in SMS
  const plain = safe
    .replace(/\*\*(.+?)\*\*/g, "$1")   // bold
    .replace(/\*(.+?)\*/g, "$1")       // italic
    .replace(/`{1,3}(.+?)`{1,3}/gs, "$1") // code
    .replace(/\[(.+?)\]\(.+?\)/g, "$1"); // links → label only

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${plain.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</Message>
</Response>`;

  return new Response(xml, {
    headers: { "Content-Type": "text/xml" },
  });
}

async function getOrCreateSession(
  db: ReturnType<typeof createClient>,
  phone: string,
): Promise<{ id: string; history: { role: string; message: string }[] }> {
  const { data, error } = await db
    .from("messaging_sessions")
    .select("id, history")
    .eq("platform", "sms")
    .eq("platform_id", phone)
    .single();

  if (data) return data as { id: string; history: { role: string; message: string }[] };
  if (error?.code !== "PGRST116") throw error;

  const { data: created, error: createErr } = await db
    .from("messaging_sessions")
    .insert({ platform: "sms", platform_id: phone, history: [] })
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
  await db
    .from("messaging_sessions")
    .update({ history: history.slice(-MAX_HISTORY) })
    .eq("id", sessionId);
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
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const body = await req.text();

  // Validate Twilio signature
  const valid = await validateTwilioSignature(req, body);
  if (!valid) return new Response("Unauthorized", { status: 401 });

  const params  = new URLSearchParams(body);
  const from    = params.get("From") ?? "";   // E.164 phone number
  const userText = (params.get("Body") ?? "").trim();

  if (!from || !userText) {
    return twimlResponse("Couldn't read your message.");
  }

  // Let users clear their history
  if (userText.toLowerCase() === "reset") {
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    await db
      .from("messaging_sessions")
      .update({ history: [] })
      .eq("platform", "sms")
      .eq("platform_id", from);
    return twimlResponse("Conversation cleared. Start fresh anytime.");
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const session = await getOrCreateSession(db, from);
    const reply   = await callChatMessage(userText, session.history);

    const newHistory = [
      ...session.history,
      { role: "USER", message: userText },
      { role: "CHATBOT", message: reply },
    ];
    await saveHistory(db, session.id, newHistory);

    return twimlResponse(reply);
  } catch (e) {
    console.error("sms-bot error:", e instanceof Error ? e.message : String(e));
    return twimlResponse("Something went wrong. Try again in a moment.");
  }
});
