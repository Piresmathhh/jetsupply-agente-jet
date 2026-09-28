-- Modulo Fornecedores (De-Para Signus): adaptador de entrada planilha de fabricante -> layout de migracao do Signus.
--
-- Adaptado do rascunho do pacote de handoff ao banco do Agente:
--   * papel do usuario pelos helpers que ja existem: public.user_role() ('admin' | 'editor' | 'comum' | 'pendente')
--     e public.is_admin(). Leitura: admin, editor e comum (so leitura). Escrita: admin e editor. Delete: so admin.
--     'pendente' e anonimo nao leem nada.
--   * categorias_zydon JA E a Categoria Treeview do Signus (mesmos 114 nos, mesmos ids e nomes, conferido em 28/09/2026).
--     Nao cria signus_categoria_treeview: fornecedor_grupos.tree_id aponta para categorias_zydon.codigo e a view
--     fornecedores_arvore entrega as folhas com o caminho completo.
--   * marcas / marcas_zydon nao tem as marcas da SBD (DeWalt, Stanley, Black+Decker...): a grafia oficial continua
--     no motor (BRAND_FIX) por enquanto.
--   * quem aprovou e quem mexeu por ultimo e carimbado pelo banco (auth.uid()), nao pelo navegador.

/* ============ tabelas ============ */

-- Perfil de de-para por fornecedor (colunas, transformacoes, valores, filtros)
create table public.fornecedor_perfis (
  id            text primary key,                  -- slug: 'mega-nexus-sbd'
  nome          text not null,
  config        jsonb not null default '{}'::jsonb, -- { map, vmap, filtros, grupoPor, chave, sheet, headerRow, siglas, split }
  assinatura    text,                              -- cabecalhos normalizados, para reconhecer o fornecedor
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);

-- Decisao por grupo de produtos (secao da planilha ou valor de coluna)
create table public.fornecedor_grupos (
  perfil_id     text not null references public.fornecedor_perfis(id) on delete cascade,
  chave         text not null,                     -- nome da secao; 'SECAO :: REF' quando dividido item a item
  tree_id       integer references public.categorias_zydon(codigo) on delete set null, -- categoria existente
  proposta      text,                              -- 'N1 > N2 > N3' quando a categoria ainda nao existe
  misto         boolean not null default false,
  sem_match     boolean not null default false,
  dividir       boolean not null default false,    -- "Item a item"
  cat_produto   text,                              -- Categoria de produto (Signus)
  grupo_carac   text,                              -- GRUPO_CARACT_CODIGO
  responsavel   uuid references auth.users(id),
  aprovado      boolean not null default false,
  aprovado_por  uuid references auth.users(id),
  aprovado_em   timestamptz,
  fonte         text check (fonte in ('ia', 'manual', 'religado')),
  confianca     text check (confianca in ('alta', 'media', 'baixa')),
  motivo        text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  primary key (perfil_id, chave)
);

-- Nome/descricao por produto: so o que foi editado, aprovado ou gerado por IA (o resto sai das regras do motor)
create table public.produto_textos (
  perfil_id     text not null references public.fornecedor_perfis(id) on delete cascade,
  ref           text not null,                     -- ref do fornecedor (coluna chave)
  nome          text,
  descricao     text,
  status        text not null default 'sugerido' check (status in ('sugerido', 'aprovado')),
  editado       boolean not null default false,
  fonte         text check (fonte in ('regra', 'ia', 'manual')),
  origem        text,                              -- nome original da planilha (vira exemplo para a IA quando aprovado)
  duvida        text,
  aprovado_por  uuid references auth.users(id),
  aprovado_em   timestamptz,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  primary key (perfil_id, ref)
);

-- Vocabulario global de tipos ("BR AR DIN" -> "Broca para Metal"), vale para todos os fornecedores
create table public.tipos_vocabulario (
  chave         text primary key,                  -- tipo bruto normalizado (norm() do motor)
  bruto         text not null,
  tipo          text,
  fonte         text check (fonte in ('ia', 'manual')),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);

-- Arvore proposta: categorias novas a cadastrar no Signus. So entra no Signus depois de aprovada.
create table public.arvore_proposta (
  caminho       text primary key,                  -- 'Ferramentas Eletricas > Serras > Serra Sabre'
  status        text not null default 'proposta' check (status in ('proposta', 'aprovada', 'cadastrada')),
  aprovado_por  uuid references auth.users(id),
  aprovado_em   timestamptz,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);

-- Grupos de caracteristicas exportados do Signus
create table public.signus_caracteristicas (
  grupo_id      text not null,
  grupo_codigo  text not null,
  grupo_nome    text,
  caract_id     text not null,
  sequencia     int,
  tipo          text,
  nome          text,
  situacao      text,
  primary key (grupo_codigo, caract_id)
);

-- Uso de IA (custo por tarefa/usuario). Escrita so pelas Edge Functions (service_role); leitura so admin.
create table public.ia_uso (
  id            bigint generated always as identity primary key,
  criado_em     timestamptz not null default now(),
  usuario       uuid references auth.users(id) on delete set null,
  tarefa        text not null,                     -- tipos | categorias | consolidar_arvore | textos | mapear_colunas | caracteristicas | chat
  itens         int,
  modelo        text,
  tokens_in     int,
  tokens_out    int,
  erro          text
);
create index ia_uso_criado_em_idx on public.ia_uso (criado_em desc);

-- Folhas da Treeview com o caminho completo (calculado, nao depende de categorias_zydon.caminho estar preenchido).
-- security_invoker: quem consulta passa pelo RLS de categorias_zydon.
create view public.fornecedores_arvore with (security_invoker = true) as
with recursive a as (
  select codigo, nome, pai, nome::text as caminho, 1 as nivel from public.categorias_zydon where pai is null
  union all
  select c.codigo, c.nome, c.pai, a.caminho || ' > ' || c.nome, a.nivel + 1
  from public.categorias_zydon c join a on c.pai = a.codigo
)
select a.codigo as id, a.nome, a.caminho, a.nivel
from a
where not exists (select 1 from public.categorias_zydon f where f.pai = a.codigo);

/* ============ triggers ============ */

-- updated_at/updated_by sempre pelo banco; aprovado_por/aprovado_em carimbados quando a aprovacao liga, limpos quando desliga.
create function public.fornecedores_carimbo() returns trigger
language plpgsql set search_path = public as $$
declare aprovou boolean; desaprovou boolean;
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_table_name = 'fornecedor_grupos' then
    aprovou := new.aprovado and (tg_op = 'INSERT' or not old.aprovado);
    desaprovou := not new.aprovado;
  elsif tg_table_name = 'produto_textos' then
    aprovou := new.status = 'aprovado' and (tg_op = 'INSERT' or old.status <> 'aprovado');
    desaprovou := new.status <> 'aprovado';
  elsif tg_table_name = 'arvore_proposta' then
    aprovou := new.status <> 'proposta' and (tg_op = 'INSERT' or old.status = 'proposta');
    desaprovou := new.status = 'proposta';
  else
    return new;
  end if;
  if aprovou then
    new.aprovado_por := auth.uid(); new.aprovado_em := now();
  elsif desaprovou then
    new.aprovado_por := null; new.aprovado_em := null;
  elsif tg_op = 'UPDATE' then
    new.aprovado_por := old.aprovado_por; new.aprovado_em := old.aprovado_em;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['fornecedor_perfis','fornecedor_grupos','produto_textos','tipos_vocabulario','arvore_proposta'] loop
    execute format('create trigger fornecedores_carimbo before insert or update on public.%I for each row execute function public.fornecedores_carimbo();', t);
  end loop;
end $$;

/* ============ RLS ============ */

do $$ declare t text; begin
  foreach t in array array['fornecedor_perfis','fornecedor_grupos','produto_textos','tipos_vocabulario','arvore_proposta'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($p$create policy "Leitura equipe - %1$s" on public.%1$I for select to authenticated using (public.user_role() in ('admin','editor','comum'));$p$, t);
    execute format($p$create policy "Escrita editor/admin - %1$s" on public.%1$I for insert to authenticated with check (public.user_role() in ('admin','editor'));$p$, t);
    execute format($p$create policy "Update editor/admin - %1$s" on public.%1$I for update to authenticated using (public.user_role() in ('admin','editor')) with check (public.user_role() in ('admin','editor'));$p$, t);
    execute format($p$create policy "Delete somente admin - %1$s" on public.%1$I for delete to authenticated using (public.is_admin());$p$, t);
  end loop;
end $$;

-- Base exportada do Signus: equipe le, so admin mexe (mesmo padrao de categorias_zydon)
alter table public.signus_caracteristicas enable row level security;
create policy "Leitura equipe - signus_caracteristicas" on public.signus_caracteristicas for select to authenticated using (public.user_role() in ('admin','editor','comum'));
create policy "Escrita somente admin - signus_caracteristicas" on public.signus_caracteristicas for insert to authenticated with check (public.is_admin());
create policy "Update somente admin - signus_caracteristicas" on public.signus_caracteristicas for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Delete somente admin - signus_caracteristicas" on public.signus_caracteristicas for delete to authenticated using (public.is_admin());

-- ia_uso: sem policy de escrita (so service_role grava); admin le
alter table public.ia_uso enable row level security;
create policy "Leitura somente admin - ia_uso" on public.ia_uso for select to authenticated using (public.is_admin());

-- Anonimo nao toca em nada do modulo (nem na view)
revoke all on public.fornecedor_perfis, public.fornecedor_grupos, public.produto_textos, public.tipos_vocabulario,
  public.arvore_proposta, public.signus_caracteristicas, public.ia_uso, public.fornecedores_arvore from anon;
revoke insert, update, delete, truncate on public.ia_uso from authenticated;
revoke execute on function public.fornecedores_carimbo() from public, anon, authenticated;

/* ============ realtime (trabalho em equipe) ============ */
alter publication supabase_realtime add table public.fornecedor_grupos, public.produto_textos, public.tipos_vocabulario, public.arvore_proposta;
