# Demonstrativo financeiro da negociação

Base: `codex/saas-cobranca`, commit `58469a827d4e2747012e0fff5b13bcf9f3404671`.

## Alteração

O modal existente mostra dívida contratual, proposta e desconto por componente, com totais conciliados, percentual e base do desconto. Cada título tem um detalhamento expansível. A conferência final identifica credor, devedor, entrada, saldo, parcelas e vencimentos. PDF, Excel e texto copiado recebem o demonstrativo da simulação válida.

As taxas e valores continuam vindo de `quote` / `cobranca_negotiate`. Quando há edição de taxas, uma segunda consulta sem overrides fornece a composição contratual; diferenças na data-base ou no total contratual impedem a exibição de uma composição não conferida. Falhas de atualização continuam bloqueando formalização e exportação.

O desconto geral existente incide no saldo inteiro. Para demonstrar sua composição, a interface utiliza rateio proporcional de apresentação, com o mesmo arredondamento cumulativo em centavos utilizado pelo servidor entre títulos. O critério é explícito na tela e nos documentos. Esse rateio não altera o cálculo, a elegibilidade dos descontos nem os registros financeiros. Os percentuais dos componentes usam o valor contratual de cada componente como base.

## Arquivos

- `web/negotiation-statement.mjs`: composição, rateio e conferência read-only.
- `web/negotiation.mjs`: integração no modal e resumo para formalização.
- `web/negotiation.css`: tabelas e detalhes no estilo do módulo.
- `web/proposal-export.mjs`: demonstrativo nos documentos existentes.
- `tests/negotiation-statement.test.mjs`: conciliação e exportações.
- `tests/negotiation-statement-ui.mjs`: fluxo em navegador com API fictícia local.

## Validação local

- `node --test tests/*.test.mjs`: 106 testes aprovados (inclui oito novos testes).
- `node tests/negotiation-rates.local.mjs`: aprovado, com PostgreSQL local PGlite e dados controlados; taxas, alçada combinada, contrato preservado, acordo, rateio, parcelas, periodicidades e isolamento.
- `node tests/negotiation-statement-ui.mjs`: aprovado no Chrome headless; comparativo, edição de descontos/taxas, entrada, parcelas, celular, confirmação, cancelamento e recarga. A API desse teste é local e não acessa produção.

## Recuperação de acordos

O botão Demonstrativo do acordo recupera cotação, valores por título e parcelas efetivamente gravadas. Novos acordos preservam `financial_snapshot` na mesma transação da formalização. Quando há redução de taxas, a composição contratual é retornada no mesmo snapshot da cotação oficial. O cálculo financeiro permanece igual.

Acordos antigos utilizam apenas a memória financeira congelada que ainda pertence ao acordo selecionado. Se a composição original anterior às reduções não foi guardada, a tela e os documentos deixam esse limite explícito. Na ausência da memória de componentes, mostram-se total e parcelas gravados; componentes não são inventados nem recalculados com o contrato atual.

## Preservação e reversão

A evolução `041-agreement-statements.sql`, também versionada em `supabase/migrations/20261028174119_agreement_statements.sql`, adiciona uma coluna nullable sem backfill. Não altera valores históricos, credenciais, fórmulas, contratos ou integrações. Não cria simulações permanentes. O snapshot é produzido pelo servidor apenas durante a formalização já autorizada pelo operador. A leitura valida empresa, perfil, acesso a todos os títulos do grupo e conciliação das parcelas.

Backup das definições das funções obtido em produção antes da alteração. O script de reversão `database/rollback/041-agreement-statements.sql` restaura as funções e desabilita a nova consulta, preservando os snapshots já gravados. A versão anterior da aplicação está preservada no commit `58469a827d4e2747012e0fff5b13bcf9f3404671`.

## Ambiente e validação

Serviço identificado: Easypanel `r2rmarketingdigital/cobranca`, domínio `financeiro.rrestrategiaperformance.com.br`, branch `codex/saas-cobranca`, banco Supabase `makpnbqtebtyrqyqdbru` na organização Cobrança. Nenhum outro serviço deve ser alterado.

Pré-conferência em produção: zero acordos formalizados e zero parcelas de acordos. As funções financeiras correspondiam às versões preservadas antes da evolução. Não são criados acordos fictícios para homologação em produção.

Testes locais: regressão unitária aprovada; teste adicional de recuperação aprovado; PGlite validou snapshots, parcelas, recuperação após mudança nos dados correntes, ausência de memória histórica, permissões e isolamento. Teste de navegador com API local controlada aprovado. A implantação e a conferência de publicação devem ser registradas no relatório de entrega.
