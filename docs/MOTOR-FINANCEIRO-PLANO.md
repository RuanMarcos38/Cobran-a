# Evolução não destrutiva do motor financeiro

Base: produção `3e9ec7863872ad5560af12d0698dab5e97264497`. Branch `codex/auditable-financial-engine`. Backup Git verificado em `../backup-motor-antes.bundle`, SHA256 `4F9E7C909D6733BA54DCCE66D2C0D021160BA6DD31BC3BF5FCA3A3EADBE46353`.

Decisão do usuário: utilizar somente regras já cadastradas e manter novas modalidades pendentes. Portanto esta evolução não ativa juros compostos, correção monetária, taxa legal, encargos futuros ou novas taxas. Não altera o motor contratual vigente nem atribui validade jurídica automática aos cadastros existentes.

## Arquitetura encontrada

Node 22, módulos JavaScript nativos, PostgreSQL/Supabase, isolamento por empresa/perfil. `financial_quote` é o cálculo central oficial; `joint_negotiation` formaliza acordos atomicamente. O calendário já separa entrada e parcelas. `cobranca_receipts` armazena pagamentos/estornos com referência única. `fee_contracts`, `fee_entries`, `fee_closings` e `fee_billing` já segregam comissões comerciais, fechamentos e faturamento da assessoria. `finance_titles`/`finance_settlements` fazem liquidação/conciliação. Importação de borderôs tem prévia, identificação e deduplicação. Acordos têm snapshots e vencimentos efetivamente gravados.

## Entrega incremental

1. Novo serviço auditável utiliza diretamente o cálculo oficial, sem outro cálculo concorrente.
2. Memórias imutáveis com versão, entradas, recebimentos, taxas vigentes, data-base brasileira e resultado; deduplicação de reprocessamentos iguais.
3. Auditoria de mudanças financeiras daqui em diante, sem copiar credenciais, contatos ou textos livres de atendimento. Sem backfill ou alteração dos valores anteriores.
4. Consulta financeira pela tela existente, filtros por credor/contrato e detalhamento de título. Totais provenientes de fatos reais, comissões separadas do saldo do devedor, contratos não classificados sinalizados.
5. Cadastro versionado de requisitos pendentes. Sem operação de ativação e sem percentuais pré-preenchidos para modalidades novas.
6. Testes de regressão, isolamento e conciliação; publicação apenas após validação.

## Limites deliberados

Não implantar uma nova metodologia jurídica sem contrato validado. Não chamar um rascunho de regra aprovada, nem considerar cadastro antigo uma comprovação jurídica. Índice ausente permanece indisponível; não interpolar nem substituir por outro. Não criar movimentações financeiras ou acordos fictícios na produção. Aprovações, pagamento, estorno e repasse continuam nas rotinas existentes e com as respectivas permissões. Um relatório não comprova repasse bancário.

Referências: Lei 14.905/2024, https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/l14905.htm ; Resolução CMN 5.171/2024, https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20CMN&numero=5171 ; CDC art. 52, https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm . A aplicabilidade depende da obrigação e de validação humana, sem inferência automática a partir de CPF/CNPJ.
