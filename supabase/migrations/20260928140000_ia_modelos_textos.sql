-- Nomes item a item com IA: Haiku 4.5 (tarefa curta, regras claras, ~US$ 2 na Mega Nexus inteira).
-- Com descricao longa: Sonnet 5, esforco baixo (segue melhor as regras de texto; ~US$ 30 na Mega Nexus inteira).
-- As outras tarefas continuam pelo nivel (tipos/caracteristicas: Haiku; categorias/mapeamento: Opus 5; consolidar: Opus 5 alto).
update public.configuracoes
set valor = jsonb_set(valor, '{tarefas}', coalesce(valor->'tarefas', '{}'::jsonb) || jsonb_build_object(
      'textos', jsonb_build_object('modelo', 'claude-haiku-4-5'),
      'textos_descricao', jsonb_build_object('modelo', 'claude-sonnet-5', 'esforco', 'low'))),
    atualizado_em = now()
where chave = 'fornecedores_ia';
