# Escopo validado e modalidades pendentes

A implantação desta etapa não equivale à implementação integral das 18 seções do pedido. Foi aplicada a decisão posterior do usuário: **somente regras já cadastradas; novas modalidades pendentes**.

| Área | Situação desta etapa |
|---|---|
| Cálculo central simples diário/mensal, carência, multa única, encargos do cadastro | Motor existente preservado; nova memória usa seu resultado oficial |
| Precisão monetária e datas | PostgreSQL numeric e regras existentes; data-base America/Sao_Paulo |
| Principal original, saldo, recebimentos e estornos | Identificados separadamente; sem dupla dedução |
| Memória reproduzível | Entradas, taxas aplicadas, recebimentos, definição/hash do motor e resultado gravados, sem sobrescrita |
| Reprocessamento | Consulta gera memória idempotente; não altera saldo registrado do título |
| Atualização diária/programada | Consulta atual usa a data-base vigente; nenhum novo agendador foi ativado |
| Auditoria financeira | Eventos posteriores à implantação para alterações de credor/título, pagamentos, estornos, acordos, contratos comerciais, fechamentos e baixas financeiras |
| Comissões da R&R | Fatos do módulo comercial existente separados do saldo do devedor; calculadas, aprovadas, faturadas e recebidas distinguíveis |
| Repasses | Previsão identificada; transferência efetiva não inferida de previsão nem executada |
| Simulador | Preservados desconto/alçada vigente, percentuais negociáveis, entrada independente e cronograma individual |
| Novas alçadas e fluxo de exceções | Não ativados; limites do motor existente continuam obrigatórios |
| Novas seis faixas de comissão | Registráveis como requisitos pendentes, sem taxas; contratos comerciais existentes não são migrados |
| Juros compostos, anuais, fixos e taxa legal | Não implementados como modalidades ativas; requerem evolução e validação contratual antes de ativar |
| Correção IPCA/INPC/IGP-M e índices oficiais | Não ativados; não há importador/sincronização oficial nesta etapa e nenhum índice é presumido |
| Encargos futuros, nova renegociação e modelos híbridos adicionais | Pendentes; não tratados como funcionalidades disponíveis |
| Enquadramento CDC/honorários | Não inferido de CPF/CNPJ; rascunho não constitui aprovação jurídica |
| PDF/XLSX da memória | Usam geradores existentes e exigem perfil administrativo atualizado |
| Importação, Kanban, atendimento, conexões | Mantidos; nenhuma credencial ou integração alterada |

## Acesso

Financeiro → Precificação e Honorários → Motor financeiro / auditoria. Dentro do simulador de acordo, Memória financeira consulta o saldo contratual, não substitui o demonstrativo da proposta editada. Administradores registram requisitos pendentes pelo credor/contrato, sem botão de ativação.

## Segurança e reversão

Novas tabelas privadas com RLS e acesso direto negado. RPC pública SECURITY INVOKER encaminha ao serviço privado com autenticação, perfil e escopo explícitos. Cobradores consultam apenas os títulos já autorizados; não acessam a visão administrativa. Eventos de baixas gerais do financeiro não são disponibilizados a supervisores. As memórias respeitam as permissões atuais do título mesmo depois de gravadas.

Reverter frontend à revisão anterior e executar database/rollback/045-audited-financial-engine.sql. A reversão desabilita o novo serviço/gatilhos sem apagar evidências ou rascunhos, nem alterar acordos e recebimentos anteriores. O backup Git não é um backup integral dos registros do banco; esta migração não reescreve esses registros.
