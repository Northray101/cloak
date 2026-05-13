-- Conversation history for Telegram and SMS bots.
-- Keyed by (platform, platform_id) where platform_id is telegram chat_id or E.164 phone number.
-- Only accessible via service role key (RLS blocks anon/authed reads).

CREATE TABLE IF NOT EXISTS public.messaging_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform    text        NOT NULL,          -- 'telegram' | 'sms'
  platform_id text        NOT NULL,          -- telegram chat_id (string) or phone number
  history     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_id)
);

ALTER TABLE public.messaging_sessions ENABLE ROW LEVEL SECURITY;

-- Deny all access from anon/authed roles; edge functions use service role key
CREATE POLICY "no_public_access" ON public.messaging_sessions
  FOR ALL USING (false);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER messaging_sessions_updated_at
  BEFORE UPDATE ON public.messaging_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
