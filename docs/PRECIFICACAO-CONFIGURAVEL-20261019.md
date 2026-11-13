# Precificação editável por versão — 19/10/2026

## Objetivo
O administrador/mestre pode configurar os valores que antes eram pré-definidos no módulo Financeiro → Precificação e Honorários, sem substituir estrutura, credenciais ou saldos já recebidos.

## Campos editáveis
- 4 limites positivos e crescentes de atraso, formando 5 faixas de títulos, e 5 taxas-base percentuais (0–100, duas casas).
- 4 limites positivos e crescentes de volume, formando 5 faixas de devedores; 5 descontos por volume (0–100 p.p., duas casas).
- Piso da taxa efetiva (0–100%), que substitui o antigo piso fixo de 8% para novas versões; piso 0 é permitido.
- 5 mínimos de gestão mensal, valores não negativos em R$, além da opção de habilitar/desabilitar desconto por volume.
- Vigência, referência contratual, modelo A/B, recebimento por credor/assessoria, condições e datas de conferência.
- No simulador, bases de recuperação, quantidade de títulos/devedores, percentual de recuperação e custos já são preenchidos pelo usuário. Se houver contrato selecionado, as taxas, descontos, piso e mínimos vêm da versão configurada.
- Juros, multas e carência contratuais do **devedor** continuam sendo campos independentes no cadastro do credor e no processo. Não confundir com honorários da assessoria.

## Segurança e consistência
- A operação `pricing_contract` sempre **insere nova versão** com auditoria, em vez de alterar versões já utilizadas.
- Os recebimentos usam os percentuais classificados e o desconto congelado na respectiva competência. Lançamentos anteriores nunca são recalculados.
- Uma versão cuja vigência invada competências já congeladas é rejeitada pelo backend; escolher vigência posterior.
- Limites e percentuais são validados no PostgreSQL e também na interface. Permissões seguem administrador/mestre (financeiro e operador apenas conforme ACL existente).
- As versões antigas sem novos campos em `terms` continuam utilizando os defaults anteriores para compatibilidade.
- Migração 021 altera somente funções PostgreSQL e a regra de check de `corporate_discount` (22 p.p. → 100 p.p.), sem UPDATE/DELETE de dados.
- A migração não recalcula juros, saldo principal nem honorários de títulos já pagos.

## Testes automatizados
- GitHub Actions: testes de banco, CRUD, conversas, recebimentos, integração simulada Evolution e precificação.
- `tests/pricing.local.mjs`: valida taxas-base 4–22%, 4 limites de atraso e 4 de volume customizados, descontos 0/2/4/6/9 e 35 p.p., piso 1%, mínimos customizados, permissões e preservação do contrato antigo.
- Números usados nos testes são fictícios em PostgreSQL descartável, sem contato com a produção.

## Implantação coordenada
**Ordem obrigatória**: revisar/mesclar PR #8 (importação e migração 020), depois PR #9 (atendimento Evolution), depois PR #10 (precificação editável e migração 021).
1. Confirmar **serviço de produção** `r2rmarketingdigital/cobranca` e qual branch/comissão GitHub está implantada no EasyPanel; não confiar apenas em push na main.
2. Identificar o **Supabase usado pelo domínio real** via configuração já existente do serviço, sem expor segredo. Nas investigações anteriores o ref esperado era `makpnbqtebtyrqyqdbru`; exigir conferência do ambiente em tempo real.
3. Ter backup de banco e verificar schema/versões aplicadas. Aplicar `database/020-bordero-csv-and-grace.sql` antes de `database/021-configurable-pricing.sql`, caso ainda não estejam presentes; migrar previamente `001–019` e agenda comercial quando necessário.
4. Publicar a versão validada, sem mudar domínio, volumes, secrets ou rede.
5. Homologar criação de novo contrato, nova versão, simulação usando parâmetros personalizados, prévia de vinculação de título, snapshot/recebimento e relatório, sempre em conta de teste autorizada. Confirmar que taxas de contratos antigos permanecem iguais.
6. Se necessário reverter código para o SHA implantado anteriormente; **não** tentar recalcular nem apagar recibos/snapshots para rollback.

**Bloqueio**: sem acesso de escrita ao EasyPanel e ao Supabase correspondente, é tecnicamente incorreto alegar publicação ou executar a migração em bancos de outros projetos.
