-- Avisos de seguranca do Supabase e visao de custo da IA.

-- rls_auto_enable() e a funcao do event trigger que liga o RLS em toda tabela nova do schema public.
-- Ninguem precisa chama-la pela API (/rest/v1/rpc); o event trigger continua funcionando sem EXECUTE.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- is_admin() e user_role() ficam executaveis por authenticated DE PROPOSITO: 29 policies de RLS cada
-- dependem delas e sao avaliadas com o papel de quem consulta. Elas so devolvem o papel do proprio usuario,
-- que ele ja le em profiles. O aviso "Signed-In Users Can Execute SECURITY DEFINER Function" e aceito.
comment on function public.is_admin() is 'Usada pelas policies de RLS; precisa de EXECUTE para authenticated. Devolve so se o proprio usuario e admin.';
comment on function public.user_role() is 'Usada pelas policies de RLS; precisa de EXECUTE para authenticated. Devolve so o papel do proprio usuario.';

-- Custo da IA por dia, tarefa, modelo e pessoa. Precos por milhao de tokens (entrada/saida, USD, set/2026):
-- Haiku 4.5 1/5, Sonnet 5 2/10, Opus 5 5/25, Opus 5.5 4/20. Modelo desconhecido fica com custo nulo.
-- security_invoker: passa pelo RLS de ia_uso, entao so admin ve.
create view public.ia_uso_resumo with (security_invoker = true) as
select
  date_trunc('day', u.criado_em at time zone 'America/Sao_Paulo')::date as dia,
  u.tarefa,
  u.modelo,
  coalesce(p.nome, p.email) as pessoa,
  count(*) as chamadas,
  count(*) filter (where u.erro is not null) as erros,
  coalesce(sum(u.itens), 0) as itens,
  coalesce(sum(u.tokens_in), 0) as tokens_in,
  coalesce(sum(u.tokens_out), 0) as tokens_out,
  round((sum(u.tokens_in) * pr.entrada + sum(u.tokens_out) * pr.saida) / 1e6, 4) as custo_usd
from public.ia_uso u
left join public.profiles p on p.id = u.usuario
left join lateral (
  select case
      when u.modelo like 'claude-haiku-4-5%' then 1.0
      when u.modelo like 'claude-sonnet-5%' then 2.0
      when u.modelo like 'claude-opus-5-5%' then 4.0
      when u.modelo like 'claude-opus-5%' then 5.0
    end as entrada,
    case
      when u.modelo like 'claude-haiku-4-5%' then 5.0
      when u.modelo like 'claude-sonnet-5%' then 10.0
      when u.modelo like 'claude-opus-5-5%' then 20.0
      when u.modelo like 'claude-opus-5%' then 25.0
    end as saida
) pr on true
group by 1, 2, 3, 4, pr.entrada, pr.saida;

revoke all on public.ia_uso_resumo from anon;
