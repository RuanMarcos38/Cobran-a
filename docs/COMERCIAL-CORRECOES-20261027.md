# Comercial: conciliação do Kanban e consulta de e-mails

Projeto confirmado pelo painel autenticado: organização Cobrança (`ttidmjxvpjgimvoqptrn`), banco `makpnbqtebtyrqyqdbru`. Base do código: `codex/saas-cobranca`, commit `3113b34`. A organização PROJETO ERP não foi alterada.

## Correções

- Uma apresentação com tentativa `accepted`, identificador do provedor e data de conclusão move uma oportunidade explicitamente vinculada de Prospecção para Contato. Exige mesmo tenant e e-mail normalizado exato. Etapas posteriores e vínculos ambíguos são preservados.
- Eventos repetidos não duplicam movimentações. Cada movimento registra atividade e auditoria com evidência e valores anteriores. O processamento sem sessão recebe identificação de sistema.
- Consulta paginada no banco, incluindo mensagens antigas armazenadas, busca por contato, endereço, assunto, conteúdo e nome/telefone da oportunidade com e-mail exatamente igual. Filtros de pasta, situação e datas de Brasília.
- A interface consulta 25 mensagens por página e busca em todas as pastas ao informar texto. Contadores vêm da consulta autorizada completa. Mensagens antigas abrem pelo identificador, sem o corte das 300 mensagens recentes da conversa. A leitura completa mantém HTML protegido e anexos.
- As funções novas mantêm controle por empresa, conta, setor e responsável. Não retornam credenciais; a listagem remove conteúdo binário de anexos.

## Verificação executada

- 98 testes existentes passaram.
- `node tests/accepted-kanban.local.mjs`: aceite, evidência ausente, resultado incerto, etapa avançada, vínculo tardio, e-mail diferente, função restrita, reaplicação e rollback sem sobrescrever edição posterior.
- `node tests/mail-query.local.mjs`: 350 mensagens, todas as páginas sem duplicação, busca, abertura da mensagem mais antiga, conteúdo completo, datas de Brasília e acesso por conta/tenant/responsável.
- Interface local: 350 mensagens fictícias, pesquisa com 111 resultados, navegação até a página 101–111 e abertura de “Mensagem 1”, anterior ao limite de 300. Nenhum envio externo.
- Banco real: 966 leads e 201 tentativas aceitas na consulta inicial. Foram conciliadas 40 oportunidades. A tela passou a mostrar 35 em Prospecção e 40 em Contato no funil e filtro vigentes. Os números globais incluem outros registros preservados fora do filtro do quadro.
- Consulta nova em produção sob papel `authenticated`: 212 mensagens em Enviados, 12 recebidas, página de 25 no momento da conferência. Esses valores podem mudar pela rotina existente.

## Aplicação e reversão

As alterações 043 e 044 foram aplicadas em transação pelo SQL Editor do projeto correto. Não houve envio de teste real, alteração de credenciais, exclusão de registros nem mudança na configuração da campanha existente.

As cópias em `supabase/migrations/` correspondem aos scripts numerados de `database/`. A reaplicação é idempotente. Scripts de reversão ficam em `database/rollback/`. O rollback 043 só devolve uma oportunidade à etapa anterior se a versão e a etapa ainda corresponderem à alteração automática; retém atividades e auditoria. Reverter primeiro a interface antes do rollback 044.

## Escopo que ainda exige execução/validação

Esta atualização não certifica o prompt completo. Permanecem: importação de todo o histórico ainda ausente no IMAP (a rotina atual lê as últimas 50 mensagens por pasta), responder a todos e encaminhar com anexos selecionados, rascunhos, encadeamento completo, reconciliação de mensagens genéricas antigas com apresentação comprovada, centralização e elegibilidade de todos os contatos, prévia/aprovação de campanha, indicadores completos e teste real em caixa expressamente autorizada. Não houve nova autorização nem ativação de disparo em lote.
