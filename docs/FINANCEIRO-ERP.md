# Financeiro e integração ERP

Esta atualização mantém a carteira de cobrança e adiciona o financeiro da assessoria. Todos os novos lançamentos são isolados por empresa no banco. Administrador e perfil Financeiro acessam títulos, crédito, banco e histórico financeiro; Comercial, Negociador, Gestor de cobrança e Cliente não recebem esse acesso. Configurar ERP é exclusivo do administrador.

## Funcionalidades

- Contas a pagar: registrar obrigações, baixas parciais ou totais, estornar com motivo e cancelar quando não houver baixas ativas. São registros financeiros; não executam transferências bancárias.
- Contas a receber: títulos da assessoria e faturas emitidas, com saldo calculado pelas baixas ativas. A fatura aparece uma vez, sem um segundo título duplicado.
- Faturamento: emitir fatura comercial, controlar recebimento e cancelamento. Não emite NF-e/NFS-e nem realiza apuração fiscal.
- Crédito: limite interno por cliente, exposição em faturas/recebíveis e bloqueio. O banco impede emissão acima do limite cadastrado. Não oferece consulta a bureau ou concessão de empréstimo. Sem regra cadastrada, não existe bloqueio por limite.
- Conciliação bancária: cadastrar contas, importar extrato CSV e vincular movimentos aos títulos financeiros. A conciliação registra a baixa. Movimento conciliado não pode ser reutilizado; estorno libera o vínculo. Não há conexão automática com bancos, Open Finance, OFX ou CNAB nesta entrega.
- Histórico dos clientes: eventos financeiros com motivo e histórico de atendimento dos processos, consultáveis por cliente.
- Cobrança: mantém processos, encargos contratuais, acordos, recebimentos e honorários existentes. O saldo do ERP é validado contra as regras do processo antes de aceitar uma baixa; divergências são rejeitadas para revisão.

## Extrato CSV

Cabeçalho: `external_ref,booked_date,amount,description`.

```csv
external_ref,booked_date,amount,description
BANCO-20261001-001,2026-10-01,150.00,Recebimento de fatura
BANCO-20261001-002,2026-10-01,-80.00,Pagamento a fornecedor
```

Datas em AAAA-MM-DD; decimais com ponto. Entradas positivas, saídas negativas. Cada conta tem identificadores únicos de extrato. Reenvio idêntico não duplica; identificador reutilizado com outro valor/data é rejeitado. Até 500 movimentos e 1 MB por importação. A correspondência é confirmada pelo operador; não há aproximação automática que possa liquidar o título errado.

## SAP, TOTVS, Protheus e Senior

O Cobrança fornece um contrato de integração canônico para SAP, TOTVS, TOTVS Protheus e Senior. Cada conexão continua restrita a um credor. Em Cadastro › Integrações / API, gere a chave. Em Financeiro › Integrações ERP, identifique o fornecedor, produto e versão da conexão.

**Selecionar o fornecedor não conecta sozinho ao ERP.** É preciso instalar/configurar o integrador no sistema de origem, mapear seus campos para o contrato abaixo e homologar suas APIs. SAP Business One e S/4HANA têm interfaces distintas; Protheus faz parte da TOTVS, mas RM e outros produtos usam interfaces diferentes; Senior também possui produtos/versões diferentes. Não foram fornecidos produto/versão, endereço técnico ou credenciais de nenhum desses sistemas. Portanto, não há um conector nativo específico nem sincronização real de fornecedor declarados ativos.

Referências oficiais para a configuração por versão:

- SAP Business One Service Layer: https://help.sap.com/doc/056f69366b5345a386bb8149f1700c19/10.0/en-US/Service%20Layer%20API%20Reference.html
- Protheus REST: https://centraldeatendimento.totvs.com/hc/pt-br/articles/360026651054-Cross-Segmento-TOTVS-Backoffice-Linha-Protheus-CRM-Nota-sobre-APIS-Protheus-CLOUD-com-a-Totvs
- Senior ERP web services: https://documentacao.senior.com.br/gestaoempresarialerp/5.10.3/webservices/com_senior_g5_co_prj_contasreceber.htm
- Senior X: https://documentacao.senior.com.br/seniorxplatform/manual-do-usuario/erp/financas/contas-pagar/integracao-contas-pagar-api.htm

### Entrada automática

`POST https://financeiro.rrestrategiaperformance.com.br/api/v1/erp_sync`

Cabeçalhos: `Content-Type: application/json` e `X-Integration-Key` com a chave da conexão. Nunca coloque chave na URL ou no navegador público. O campo provider precisa corresponder ao fornecedor cadastrado (`sap`, `totvs`, `protheus`, `senior` ou `generic`).

Exemplo de dívidas vencidas:

```json
{"provider":"protheus","operation":"overdue","external_id":"LOTE-20261001-001","contract_ref":"CONTRATO-001","items":[{"external_ref":"TITULO-001","original_amount":"1000.00","due_date":"2026-09-01","debtor_name":"Devedor","debtor_document":"Documento"}]}
```

Aceita apenas vencimento anterior à data atual. Requer credor e negociador ativos; encargos seguem contrato cadastrado no credor. Um título previamente recebido não é recriado ou sobrescrito.

Exemplo de baixas informadas pelo ERP:

```json
{"provider":"protheus","operation":"payments","external_id":"BAIXAS-20261001-001","items":[{"external_ref":"TITULO-001","reference":"BAIXA-001","amount":"200.00","paid_date":"2026-10-01"}]}
```

O título deve existir no credor da conexão. Valida valor positivo, centavos, saldo e data; registra honorários conforme cliente, aloca parcelas de acordo e gera comissão conforme regra existente. Não aceita pagamentos futuros. Referência repetida com outros dados ou anteriormente estornada é rejeitada. Não há estorno automático de origem nessa versão: eventos de estorno precisam de conferência e autorização financeira no Cobrança.

`external_id` identifica cada evento na conexão: repetição idêntica retorna resultado anterior; conteúdo diferente com o mesmo identificador é rejeitado. Até 100 itens por lote e 1 MB; falha em qualquer item reverte o lote inteiro. O integrador deve persistir identificadores e reenviar somente após conferir os erros.

### Retorno ao ERP

```json
{"provider":"protheus","operation":"poll","cursor":0}
```

Retorna até 100 eventos de recebimento/estorno do credor, ordenados por `seq`, e o próximo `cursor`. O integrador deve guardar o cursor **depois** de aplicar todos os eventos com sucesso. Eventos são disponibilizados após a instalação da fila; recebimentos históricos anteriores não são automaticamente exportados.

Cada evento inclui receipt_id, external_ref, reference, amount, fee_amount, paid_date, reversed e origin. O integrador usa receipt_id/seq para evitar duplicação. Eventos `origin=erp` são confirmação de entrada: não devem gerar uma nova baixa de volta no ERP. Repetições de consulta são permitidas; cursor não representa confirmação de aplicação pelo fornecedor. A fila disponibiliza os dados; a aplicação da baixa no SAP/TOTVS/Senior é responsabilidade do adaptador autorizado naquele ERP.

## Homologação

Testes locais cobrem regras financeiras, isolamento, banco e fluxo canônico ERP. Esses testes não substituem homologação em um SAP/TOTVS/Senior real. Falta identificar os produtos/versões, conectar o integrador de origem e destino e validar amostras autorizadas. Também permanecem pendentes a confirmação de e-mail externo e o ensaio de restauração de backup.
