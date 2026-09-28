import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  'https://agente.jetsupply.com.br',
  'http://agente.jetsupply.com.br',
  'https://piresmathhh.github.io',
];

// Limites do chat livre: o index.html ja guarda so as ultimas 20 mensagens e respostas de ate 4 linhas.
const MAX_MENSAGENS = 20;
const MAX_CHARS_MENSAGEM = 4000;
const MAX_CHARS_SYSTEM = 20000;

function corsHeadersFor(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

function ok(body: unknown, corsHeaders: Record<string,string>) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return ok({ error: 'Sem autenticação.' }, corsHeaders);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return ok({ error: 'Usuário não identificado.' }, corsHeaders);

    // Chave Claude nunca sai do servidor — lida aqui via service_role, direto da tabela trancada por RLS
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Só admin e editor usam a chave da Jet (cadastro pendente e papel "comum" ficam de fora)
    const { data: perfil } = await adminClient.from('profiles').select('role').eq('id', userData.user.id).maybeSingle();
    if (!['admin', 'editor'].includes(perfil?.role)) return ok({ error: 'Seu acesso ainda não foi aprovado para usar o chat.' }, corsHeaders);

    const body = await req.json().catch(() => ({}));
    const system = String(body?.system || '').slice(0, MAX_CHARS_SYSTEM);
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (!messages.length) return ok({ error: 'Nenhuma mensagem enviada.' }, corsHeaders);
    if (messages.length > MAX_MENSAGENS) return ok({ error: `Conversa longa demais (máximo ${MAX_MENSAGENS} mensagens).` }, corsHeaders);
    const validas = messages.every((m: any) =>
      (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.length <= MAX_CHARS_MENSAGEM);
    if (!validas) return ok({ error: `Mensagem inválida ou longa demais (máximo ${MAX_CHARS_MENSAGEM} caracteres).` }, corsHeaders);

    const { data: secretRow } = await adminClient.from('configuracoes_secretas').select('valor').eq('chave', 'claude_api_key').maybeSingle();
    const key = secretRow?.valor?.key;
    if (!key) return ok({ error: 'no_key_configured' }, corsHeaders);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5', max_tokens: 500, system,
        messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      await adminClient.from('ia_uso').insert({ usuario: userData.user.id, tarefa: 'chat', itens: 1, erro: `http_${r.status}` });
      return ok({ error: e.error?.message || `HTTP ${r.status}` }, corsHeaders);
    }
    const data = await r.json();
    await adminClient.from('ia_uso').insert({
      usuario: userData.user.id, tarefa: 'chat', itens: 1, modelo: data.model,
      tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
    });
    const reply = data.content?.[0]?.text || '';
    return ok({ reply }, corsHeaders);
  } catch (e) {
    return ok({ error: String((e as Error)?.message || e) }, corsHeadersFor(req));
  }
});
