do $migration$
declare
  def text;
  anchor text;
  predicate constant text := $predicate$split_part(lower(trim(%s.email)), '@', 1) ~ '^(financeiro|finance|financial|contas[._-]?a[._-]?receber|contas[._-]?receber|accounts[._-]?receivable|recebiveis|tesouraria)([._-][a-z0-9]+)*$'$predicate$;
begin
  select pg_get_functiondef('cobranca_private.prospect_receive_v1(text,jsonb)'::regprocedure) into def;
  anchor := 'x.status=''ready'' and not x.suppressed';
  if strpos(def, anchor) = 0 then raise exception 'Seleção de envio incompatível'; end if;
  if strpos(def, format(predicate, 'x')) = 0 then
    execute replace(def, anchor, anchor || ' and ' || format(predicate, 'x'));
  end if;
  select pg_get_functiondef('cobranca_private.prospect_receive_before_attachment(text,jsonb)'::regprocedure) into def;
  anchor := 'status=''pending'' and not suppressed and last_seen_at';
  if strpos(def, format(predicate, 'q')) = 0 then
    if strpos(def, anchor) = 0 then raise exception 'Aprovação automática incompatível'; end if;
    execute replace(def, anchor, 'status=''pending'' and not suppressed and ' || format(predicate, 'q') || ' and last_seen_at');
  end if;
end
$migration$;
