# Simulador — vencimentos, modalidades e parcelas (2026-11-04)

## Implementação incremental
- PR #68: valores individuais, entrada e vencimentos editáveis; migração 20261104190000_editable_installment_amounts.sql (corrigida).
- PR #69: dias civis vencidos, seleção de Pagamento Direto por título com taxa contratual própria e separada de honorários; migrações 20261104210000_overdue_calendar_days.sql e 20261104211000_direct_payment_quotes.sql.
- Esta revisão: ordenação visual do demonstrativo por vencimento original crescente (padrão), alternável para decrescente pelo cabeçalho, desempate estável por ID. Nenhuma alteração nas tabelas nem na ordem física dos registros.
- Somatórios continuam baseados na lista original do backend, não na ordem visual. Botões de baixa, controles de taxas e Pagamento Direto utilizam sempre os IDs persistentes.
- Coluna renomeada para **Dias Vencidos**. Dias sujeitos à cobrança e carência permanecem no backend.
- Uma distribuição manual temporariamente divergente permanece visível para correção, mas a formalização e a exportação são bloqueadas até a conciliação.

## Segurança e pré-requisitos de produção
1. Confirmar URL exata e commit/deploy real (a captura pode mostrar outro host) antes de modificar produção.
2. Conectar o Supabase que possui `cobranca_private` e verificar hashes/diferenças das funções financeiras efetivas, além da sequência de migrations.
3. Backup completo da definição das funções, banco e registros financeiros; plano de rollback validado em staging.
4. Homologar integração real em staging com credores e devedores fictícios e operações autorizadas. Verificar isolamento por tenant, recebimentos parciais, acordos ativos, snapshots financeiros e contratos.
5. Verificar documentação e autorização legal/contratual da isenção de encargos por Pagamento Direto; a taxa específica não é inferida de honorários.
6. Validar visualmente desktop, mobile, scroll horizontal, seleção após ordenação e recálculo de valores.
7. Executar merge e deploy controlado apenas após aprovação; validar integridade no domínio de produção sem formalizar acordos de clientes reais como teste.

## Comandos de teste
- `npm test` (inclui `tests/negotiation-title-sort.test.mjs`, `tests/days-in-arrears.test.mjs`).
- `node tests/direct-payment.local.mjs` (PostgreSQL/PGlite com dados fictícios).
- `npm run test:db` e demais scripts existentes do GitHub Actions.

**Status:** implementação no GitHub, ainda sem homologação em banco remoto e sem deploy autorizado.
