// Edge Function ia-fornecedores: IA do modulo Fornecedores (De-Para Signus).
//
// POST { tarefa, dados } -> { resultado, uso: { tokens_in, tokens_out, modelo } }   (erro: { error, codigo })
//
// O navegador nunca manda prompt: so a tarefa e os dados estruturados, validados e recortados em tarefas.mjs.
// A chave da API fica em configuracoes_secretas (so service_role le) e nunca sai do servidor.
// So admin e editor usam; cada chamada fica registrada em ia_uso.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { TAREFAS, DEFAULT_TXT, MODELOS_PADRAO, ErroEntrada, montarRequisicao } from "./tarefas.mjs";

const ALLOWED_ORIGINS = [
  'https://agente.jetsupply.com.br',
  'http://agente.jetsupply.com.br',
  'https://piresmathhh.github.io',
];
const LIMITE_POR_MINUTO = 40; // chamadas por usuario; padronizar tipos da Mega Nexus usa ~24 em sequencia

function corsHeadersFor(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

// Mesmo padrao das outras functions do Agente: sempre 200, erro no corpo (o supabase-js esconde a mensagem em nao-2xx).
function ok(body: unknown, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const falha = (codigo: string, error: string) => ({ error, codigo });

// Contexto que vem do banco, nunca do navegador.
async function carregarContexto(db: SupabaseClient, nomes: string[], lote: any[], dados: any) {
  const ctx: Record<string, unknown> = {};
  if (nomes.includes('vocabulario')) {
    const { data, error } = await db.from('tipos_vocabulario').select('tipo').not('tipo', 'is', null).order('updated_at', { ascending: false }).limit(1000);
    if (error) throw error;
    ctx.vocabulario = [...new Set((data || []).map(r => r.tipo))].slice(0, 300);
  }
  if (nomes.includes('arvore')) {
    const { data, error } = await db.from('fornecedores_arvore').select('id,caminho').order('caminho');
    if (error) throw error;
    ctx.arvore = (data || []).map(r => ({ id: String(r.id), caminho: r.caminho }));
  }
  if (nomes.includes('propostos')) {
    const [ap, gp] = await Promise.all([
      db.from('arvore_proposta').select('caminho').order('updated_at', { ascending: false }).limit(200),
      db.from('fornecedor_grupos').select('proposta').is('tree_id', null).not('proposta', 'is', null).order('updated_at', { ascending: false }).limit(500),
    ]);
    if (ap.error) throw ap.error;
    if (gp.error) throw gp.error;
    ctx.propostos = [...new Set([...(ap.data || []).map(r => r.caminho), ...(gp.data || []).map(r => r.proposta)])].slice(0, 200);
  }
  if (nomes.includes('txt')) {
    const { data } = await db.from('configuracoes').select('valor').eq('chave', 'fornecedores_txt').maybeSingle();
    ctx.txt = { ...DEFAULT_TXT, ...(data?.valor || {}) };
  }
  if (nomes.includes('exemplos')) {
    let q = db.from('produto_textos').select('nome,origem').eq('status', 'aprovado').not('nome', 'is', null).not('origem', 'is', null);
    if (typeof dados?.perfil_id === 'string' && dados.perfil_id) q = q.eq('perfil_id', dados.perfil_id.slice(0, 80));
    const { data, error } = await q.order('editado', { ascending: false }).order('updated_at', { ascending: false }).limit(8);
    if (error) throw error;
    ctx.exemplos = (data || []).map(r => ({ nome: String(r.nome).slice(0, 200), origem: String(r.origem).slice(0, 300) }));
  }
  if (nomes.includes('caracteristicas')) {
    const grupo = lote[0]?.grupo;
    const { data, error } = await db.from('signus_caracteristicas').select('grupo_nome,caract_id,nome,tipo,sequencia').eq('grupo_codigo', grupo).order('sequencia');
    if (error) throw error;
    if (!data?.length) throw new ErroEntrada(`Grupo de caracteristicas "${grupo}" nao existe na base do Signus.`);
    ctx.caracteristicas = { nome: data[0].grupo_nome || grupo, caracs: data.map(c => ({ id: String(c.caract_id), nome: c.nome, tipo: c.tipo })) };
  }
  return ctx;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);
  let usuario: string | null = null, tarefa = '', itens = 0;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return ok(falha('sem_auth', 'Sem autenticação.'), corsHeaders);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return ok(falha('sem_auth', 'Usuário não identificado.'), corsHeaders);
    usuario = userData.user.id;

    // Papel conferido no servidor: so admin e editor usam a IA.
    const { data: perfil } = await admin.from('profiles').select('role').eq('id', usuario).maybeSingle();
    if (!['admin', 'editor'].includes(perfil?.role)) {
      return ok(falha('sem_permissao', 'Seu acesso não permite usar a IA. Peça a um admin.'), corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    tarefa = String(body?.tarefa || '');
    const t = (TAREFAS as Record<string, any>)[tarefa];
    if (!t) return ok(falha('tarefa_invalida', 'Tarefa desconhecida.'), corsHeaders);

    const umMinutoAtras = new Date(Date.now() - 60_000).toISOString();
    const { count } = await admin.from('ia_uso').select('id', { count: 'exact', head: true }).eq('usuario', usuario).gte('criado_em', umMinutoAtras);
    if ((count || 0) >= LIMITE_POR_MINUTO) {
      return ok(falha('rate_limited', 'Muitas chamadas seguidas. Espere um minuto e continue: o que já foi gerado ficou salvo.'), corsHeaders);
    }

    const lote = t.entrada(body?.dados);
    itens = lote.length;
    if (!itens) return ok({ resultado: [], uso: { tokens_in: 0, tokens_out: 0, modelo: null } }, corsHeaders);

    const [ctx, cfgR, keyR] = await Promise.all([
      carregarContexto(admin, t.contexto, lote, body?.dados),
      admin.from('configuracoes').select('valor').eq('chave', 'fornecedores_ia').maybeSingle(),
      admin.from('configuracoes_secretas').select('valor').eq('chave', 'claude_api_key').maybeSingle(),
    ]);
    const apiKey = keyR.data?.valor?.key;
    if (!apiKey) return ok(falha('no_key_configured', 'A chave da API do Claude não está configurada.'), corsHeaders);

    const requisicao = montarRequisicao(tarefa, lote, ctx, cfgR.data?.valor || MODELOS_PADRAO);
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
    const resp = await client.messages.create(requisicao as Anthropic.MessageCreateParamsNonStreaming);
    const uso = { tokens_in: resp.usage.input_tokens, tokens_out: resp.usage.output_tokens, modelo: resp.model };

    let erro: string | null = null;
    let json: unknown = null;
    if (resp.stop_reason === 'refusal') erro = 'recusa';
    else if (resp.stop_reason === 'max_tokens') erro = 'resposta_cortada';
    else {
      const texto = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
      try { json = JSON.parse(texto); } catch { erro = 'invalid_json'; }
    }
    await admin.from('ia_uso').insert({ usuario, tarefa, itens, modelo: uso.modelo, tokens_in: uso.tokens_in, tokens_out: uso.tokens_out, erro });

    if (erro === 'recusa') return ok({ ...falha('recusa', 'A IA recusou este lote. Revise os itens e tente de novo.'), uso }, corsHeaders);
    if (erro === 'resposta_cortada') return ok({ ...falha('resposta_cortada', 'A resposta da IA ficou grande demais. Tente um lote menor.'), uso }, corsHeaders);
    if (erro) return ok({ ...falha('invalid_json', 'A IA respondeu fora do formato. Tente de novo.'), uso }, corsHeaders);

    return ok({ resultado: t.saida(json, lote, ctx), uso }, corsHeaders);
  } catch (e) {
    if (e instanceof ErroEntrada) return ok(falha('entrada_invalida', e.message), corsHeaders);
    let codigo = 'erro', mensagem = 'A IA não respondeu. O que já foi gerado ficou salvo.';
    if (e instanceof Anthropic.RateLimitError) {
      codigo = 'rate_limited'; mensagem = 'Limite de uso da API atingido. Espere um pouco e continue: o que já foi gerado ficou salvo.';
    } else if (e instanceof Anthropic.APIError && e.status === 529) {
      codigo = 'sobrecarga'; mensagem = 'A API do Claude está sobrecarregada agora. Tente de novo em instantes.';
    } else if (e instanceof Anthropic.AuthenticationError) {
      codigo = 'chave_invalida'; mensagem = 'A chave da API do Claude foi recusada. Um admin precisa atualizá-la.';
    } else if (e instanceof Anthropic.APIError) {
      codigo = `api_${e.status ?? 'erro'}`;
    }
    console.error('ia-fornecedores', tarefa, codigo, e);
    if (usuario && tarefa) await admin.from('ia_uso').insert({ usuario, tarefa, itens, erro: codigo }).then(() => {}, () => {});
    return ok(falha(codigo, mensagem), corsHeaders);
  }
});
