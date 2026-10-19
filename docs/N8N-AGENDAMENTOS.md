# Calls de apresentação com n8n

O fluxo recebe calls já confirmadas por um formulário, atendimento ou automação e registra a reunião em **Comercial → Agendamentos**. Remarcações e cancelamentos atualizam a mesma reunião. O responsável pode abrir o link e editar a call na ferramenta. A tela consulta alterações a cada 15 segundos quando está visível e sem janela de edição aberta.

O fluxo não realiza prospecção, ligações, mensagens a clientes, negociação de horários ou geração de links/convites de videoconferência. Esses passos podem enviar a call confirmada ao webhook. Nenhum fluxo existente precisa ser alterado para usar a integração.

## Instalação preservando a versão atual

Base: branch `codex/saas-cobranca`, commit `343c37f2f7d77b31bd2c1b4e7d62b95165f20ecd`.

1. Guarde a versão atual da aplicação. Após os scripts legados de `database/` até `015-pricing.sql`, aplique **uma vez** `supabase/migrations/20261019005921_n8n_commercial_schedule.sql` em uma transação. Em banco existente, aplique apenas esse novo arquivo; não recrie o banco. O arquivo foi criado com a CLI oficial `supabase migration new`.
2. Publique o código. A alteração é aditiva: não apaga agendamentos existentes, cadastros, credenciais, regras de cobrança ou honorários.
3. Como administrador, abra **Comercial → Integração n8n**, escolha o responsável e clique em **Conectar n8n**. A chave é exibida uma vez; no banco fica apenas seu hash. Gere a chave somente no ambiente que será conectado.
4. Importe `workflows/n8n-agendamentos.json` no n8n. Uma cópia pode ser baixada pela interface da ferramenta.
5. No n8n, crie uma credencial **Header Auth**: Name `X-Integration-Key`, Value igual à chave gerada. Selecione-a no Webhook e nos dois nós HTTP Request. Não grave a chave no código do fluxo, notas, GitHub ou conversa.
6. Teste a conexão com `{"operation":"health"}`. Esse teste não cadastra reunião. Publique o fluxo somente após conectar e testar as credenciais.

Fluxo criado nesta implementação: **Cobrança · Calls de apresentação · Agenda comercial**.

## Endereços

- API da ferramenta: `POST https://r2rmarketingdigital-cobranca.ke4n49.easypanel.host/api/v1/commercial_schedule`
- Webhook de produção do fluxo: o endereço exibido pelo nó **Receber call confirmada**, com caminho `cobranca-calls-comercial`. Use o endereço fornecido pelo próprio n8n, pois o webhook de teste tem outro endereço.
- Ambos exigem o cabeçalho `X-Integration-Key`. O fluxo usa a mesma credencial para autenticar o chamador e acessar a agenda. Trate o webhook como privado: qualquer portador dessa chave pode operar a agenda daquele responsável.

## Criar uma call

Envie ao webhook JSON como este, substituindo os exemplos pelos dados de uma reunião confirmada:

```json
{
  "event_id": "reuniao-123-criada-v1",
  "external_id": "reuniao-123",
  "revision": 1,
  "name": "Apresentação da empresa",
  "due_at": "2026-10-20T14:00:00-03:00",
  "end_at": "2026-10-20T14:30:00-03:00",
  "status": "Aberto",
  "company": "Empresa do cliente",
  "contact_name": "Contato comercial",
  "contact_email": "contato@example.invalid",
  "contact_phone": "",
  "meeting_url": "https://example.invalid/reuniao",
  "notes": "Apresentação dos serviços"
}
```

`external_id` identifica a reunião e permanece igual em todas as alterações. Cada mudança usa `event_id` novo e `revision` maior. Reenvie exatamente o mesmo evento em uma repetição de transporte; ele não cria duplicidade. Reutilizar um evento com dados diferentes ou enviar revisão antiga gera conflito.

Para remarcar, envie o mesmo `external_id`, um novo `event_id`, a próxima revisão e os novos horários. Para cancelar ou concluir, faça o mesmo com `status` igual a `Cancelado` ou `Concluído`, preservando os demais campos. O fluxo consulta a versão atual antes de gravar; uma edição concorrente é rejeitada para nova conferência. Não configure repetição infinita para conflitos de negócio.

Início e fim precisam informar `Z` ou deslocamento de fuso, como `-03:00`. A duração deve ser maior que zero e de até oito horas. A ferramenta mostra datas no fuso do navegador e converte corretamente edições para UTC. Calls abertas que se sobrepõem para o mesmo responsável são bloqueadas; a origem deve oferecer outro horário antes de confirmar ao cliente.

## Consultar alterações feitas pela equipe

O endpoint também recebe `{"operation":"list"}` e retorna até 100 reuniões do responsável, ordenadas por `updated_at` e `id`. Para continuar, envie `cursor_at` e `cursor_id` da última linha. Isso permite a outro fluxo consultar edições manuais. O fluxo entregue faz sincronização de entrada; não cria automaticamente eventos no Google Calendar ou Outlook.

`{"operation":"lookup","external_id":"reuniao-123"}` retorna a reunião daquela conexão. O envio direto à API exige `operation: "upsert"` e `expected_version` para atualizar uma reunião existente. O fluxo entregue preenche esses campos.

## Proteções e verificação

- Configuração exclusiva de administrador; a equipe comercial vê somente a agenda permitida ao seu perfil.
- Chave restrita ao calendário do responsável e à empresa, sem acesso a cobrança ou financeiro.
- Tabelas privadas com RLS, política explícita de bloqueio e privilégios revogados.
- Rotação e desativação da chave preservam todas as calls já cadastradas.
- Registro dos eventos aceitos e auditoria sem registrar o segredo.
- Histórico de execuções do fluxo desativado por padrão para reduzir armazenamento de dados de contato.
- O teste local cobre API, banco, fluxo, interface, repetição, revisões, remarcação, cancelamento, fuso, conflito e permissões. Credenciais reais e webhook publicado exigem teste de conexão no ambiente de destino.

## Voltar à versão anterior

Despublique o fluxo e desative a conexão antes de restaurar a imagem anterior da aplicação. Deixe as novas tabelas e colunas no banco para preservar reuniões e auditoria; a versão anterior ignora os campos adicionais. Não remova tabelas nem reaplique os scripts de criação. A migração nova pode ser mantida enquanto se investiga um problema.

Referências: [HTTP Request no n8n](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/) e [funções de banco no Supabase](https://supabase.com/docs/guides/database/functions).
