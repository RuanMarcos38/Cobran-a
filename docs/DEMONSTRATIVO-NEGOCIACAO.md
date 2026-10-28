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

## Preservação e reversão

Nenhuma alteração de banco, migração, credencial ou integração. Não foram modificados os mecanismos oficiais de cálculo, as regras de acesso ou os eventos de auditoria existentes. Nenhuma simulação é persistida por esta alteração.

A versão anterior do código está preservada no commit base. A proposta fica em branch separada. Antes de eventual implantação, registrar a revisão atualmente implantada e o artefato de publicação; reverter consiste em restaurar esse artefato ou reverter o commit desta proposta. Não há migração de dados para reverter.

## Status e pendências

Implementação preparada para revisão; não implantada e não validada no ambiente real. A aprovação da proposta não equivale à implantação. A origem exata da publicação e a versão em produção não foram confirmadas neste trabalho.

O demonstrativo adicional de acordo é exportado na sessão em que a formalização retorna sucesso. A reconstrução desse novo detalhamento em acordos históricos, após reabrir a página, não está incluída: ela exigiria definir e persistir um snapshot oficial adicional no fluxo do servidor. Os documentos e históricos já existentes continuam disponíveis.

A conferência original por componentes utiliza duas leituras oficiais e verifica data-base e total contratual; não constitui um snapshot transacional conjunto. O servidor continua validando sua própria assinatura antes de gravar o acordo. Antes da disponibilização em produção, revisar esse limite e decidir se o servidor deverá retornar a composição contratual no mesmo snapshot.

Os testes de navegador usam uma API controlada; os testes de banco validam separadamente o fluxo real de formalização. Ainda é necessária a homologação integrada com o ambiente de publicação e os contratos reais autorizados.
