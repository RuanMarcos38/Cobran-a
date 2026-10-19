# Precificação e Honorários

## Identidade e recuperação

Aplicação existente: RuanMarcos38/Cobran-a, branch `codex/saas-cobranca`.
Serviço EasyPanel: `r2rmarketingdigital / cobranca`.
Estado anterior: commit `6e8f39ceefadc74303f6138fda83363b9cf1dfc7`, preservado na branch `backup/antes-honorarios-20261018`.
Banco confirmado pela configuração pública e pelo painel Supabase: `makpnbqtebtyrqyqdbru`.
Auditoria anterior à implantação: 0 credores, 0 títulos, 0 recebimentos; roteador correspondente à migration 014.

## Operação

Em **Financeiro**, há quatro seções novas: Precificação e Honorários, Simulador financeiro, Fechamento mensal e Resultado da Cobrança. As seções anteriores e a autenticação permanecem no lugar.

1. Cadastre o credor no cadastro existente.
2. Crie um contrato com referência igual à dos títulos, modelo A ou B, vigência e condições comerciais.
3. Para títulos anteriores, use **Prévia dos títulos**. Confirme a vinculação com motivo: títulos que já possuam recebimentos nunca serão recalculados ou vinculados retroativamente.
4. Para importar CSV, use **Importar carteira CSV** no contrato. Cabeçalhos: `external_ref,debtor_name,debtor_document,original_amount,due_date`; `entry_date` é opcional e representa a entrada original em gestão. Datas ISO e valores decimais com ponto. São aceitos até 500 títulos/1 MB por lote. Confira a prévia; pendências bloqueiam a confirmação. CPF/CNPJ repetido com títulos diferentes é permitido. O lote e as referências são idempotentes; divergências não sobrescrevem títulos.
5. Novos títulos dos fluxos antigos, borderô e ERP são classificados pelo mesmo mecanismo no banco, desde que a referência corresponda a um contrato vigente. Os layouts e endpoints anteriores continuam funcionando.
6. Na ficha do processo classificado, registre o recebimento com origem e identificador bancário da transação, confirmação e conciliação. Utilize a mesma origem e identificação em todas as integrações para que uma transação não seja contabilizada novamente. Um pagamento distribuído por vários títulos deve informar a alocação real em cada título. Parcelas futuras não geram comissão.
7. No início da competência, congele o volume. A política administrativa permite exigir snapshot explícito ou congelar na primeira operação financeira. Documentos inválidos bloqueiam snapshots que dependam do volume; não há contagem presumida.
8. Apure o demonstrativo preliminar, confira e aprove após o encerramento do mês. Aprovar congela o demonstrativo, sem gerar cobrança externa.
9. **Registrar fatura aprovada** é uma ação separada: registra fatura comercial/contas a receber no financeiro existente. Não emite nota fiscal ou boleto nem faz transferência. Honorários já retidos pela assessoria são excluídos do valor a faturar ao credor. Baixas e estornos das faturas usam as funções financeiras existentes.

## Regras financeiras

- Faixas iniciais de atraso: 10/15/20/25/30%, calculadas pelo vencimento original na entrada da carteira. Faixa 0 não vencida tem taxa zero.
- Desconto por volume: 0/1/2/3/4 pontos percentuais; piso 8% para títulos vencidos. Faixa corporativa configurável.
- Modelo A: sem mínimo, sem desconto por padrão. Modelo B: mínimos 590/990/1990/4990/8990, compensáveis com a comissão.
- Todos os valores autoritativos usam `numeric` no PostgreSQL e arredondamento monetário de duas casas. JavaScript apenas apresenta os valores.
- Versões e classificações são preservadas. Nova versão só pode iniciar depois das competências já congeladas. O mínimo aplica-se uma vez por referência contratual e competência, mesmo com versões anteriores possuindo títulos ativos.
- Estorno gera lançamento negativo adicional; após fechamento, o ajuste é lançado na próxima competência aberta e mantém a competência de origem. Créditos negativos permanecem no demonstrativo, para compensação financeira; não são convertidos em movimentação bancária automática.
- Pagamento direto ao credor gera honorários a faturar, sem indicar retenção ou repasse inexistentes.
- CPF e CNPJ numérico/alfanumérico são normalizados e validados por dígito verificador. Referência oficial do CNPJ: https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj .

## Permissões e dados

Administrador configura e importa; financeiro concilia, apura, aprova e registra fatura; gestor consulta e simula. Operadores e portal credor mantêm seus acessos anteriores. O módulo não amplia permissões do portal ou de operadores. Toda RPC verifica usuário ativo, empresa e função. Tabelas novas são privadas, com RLS e sem acesso direto; funções internas não podem ser executadas pelo navegador.

O dashboard usa o ledger real e permite recortes por competência, credor, contrato e operador. Apresenta carteira, saldo, títulos, documentos únicos válidos, negociações, recuperação, honorários, retenções, faturamento e baixas, faixas e evolução mensal. Totais de faturas são do contrato e não são rateados artificialmente por operador. Títulos legados continuam nos relatórios anteriores até sua vinculação.

Exportação utiliza CSV compatível com Excel e impressão/salvar como PDF, seguindo a infraestrutura existente. Não há emissão fiscal ou integração bancária nova.

## Implantação e rollback

Aplicar `database/015-pricing.sql` após a 014, no projeto Cobrança confirmado. É uma transação aditiva: oito tabelas privadas, funções, quatro triggers e extensão do roteador existente. Não altera credenciais, políticas de login, tabelas ou dados antigos, nem cria mensalidades para credores existentes.

Publicar o código na branch já utilizada pelo EasyPanel, preservando fonte, domínio, ambiente e armazenamento existentes. Validar `/health`, as quatro seções e as funções anteriores. Não executar fixtures de teste no banco de produção.

Rollback operacional: restaurar a versão da branch de backup e executar `database/rollback/015-pricing.sql`. Isso desativa hooks e roteamento novos, preservando tabelas e lançamentos para auditoria. Não reaplicar a migration 015 após rollback sem uma migration de reativação revisada.

## Validação

`node --test tests/*.test.mjs`: dinheiro, CSV, isolamento de sessão, API e integração WhatsApp.
`node tests/database.local.mjs`: CRUD, recebimentos, acordos, estornos e permissões existentes.
`node tests/finance.local.mjs` e `node tests/sectors.local.mjs`: financeiro, ERP, borderôs e operações existentes, com a migration nova carregada.
`node tests/pricing.local.mjs`: cenários comerciais, limites, CPF/CNPJ, 600 devedores reais em fixture, importação/prévia/replay, pagamentos, estorno, fechamento, versões, faturamento e isolamento.
`PRICING_UI=1 node tests/pricing.local.mjs`: adiciona testes reais da interface com PostgreSQL local e autenticação de teste.
`node tests/ui.local.mjs`: regressão da interface anterior, papéis, importações, acordos e financeiro.

Os testes locais usam dados descartáveis e não se conectam a provedores de cobrança. A verificação em produção é somente de consulta e interface, sem cobranças, notas ou transferências de teste.
