# Parcelas editáveis — rollout controlado

Base: `codex/baixas-financeiras`. Branch: `feature/simulador-parcelas-editaveis`.

## Alterações
- Seleção entre modo automático e personalizado.
- Edição independente de vencimento da entrada e vencimentos das parcelas.
- Edição independente de valores, inclusive a entrada, com aritmética em centavos.
- Conferência imediata da diferença; formalização bloqueada se houver divergência.
- Migração PostgreSQL aceita `payment_amounts` opcional, valida cada valor, quantidade e soma antes de criar acordo, distribuindo valores entre os títulos selecionados sem alterar recibos existentes.
- Clientes antigos sem `payment_amounts` continuam no parcelamento automático.

## Antes do merge
1. Confirmar que esta branch é ancestral/compatível com o commit efetivamente implantado no domínio financeiro.
2. Executar `npm test` e `node --test tests/negotiation-custom-amounts.test.mjs` em Node >=22.
3. Homologar a migração em PostgreSQL/Supabase de staging, após a migration 20261029125502, com testes de acordo único, múltiplos títulos, parcelas desiguais, desconto e conflito de snapshot.
4. Validar aplicação real de migration somente no staging; testar transações, permissões/RLS, períodos, baixa parcial, históricos e isolamento por tenant.
5. Validar interface mobile e desktop, exportações e equivalência dos valores gravados/retornados.
6. Confirmar branch de produção antes do deploy; nenhum deploy é automático.

## Observações
- A migração substitui a definição da função de formalização sem remover tabelas ou registros. **Faça backup da definição efetiva antes da aplicação**.
- Não permitir aprovação se o cronograma diferir do saldo do acordo.
- Os acordos com pagamentos já efetuados permanecem imutáveis por este recurso.
- Adicionar/remover parcelas em simulação continua controlado pelo campo de quantidade de parcelas (1 a 120).
