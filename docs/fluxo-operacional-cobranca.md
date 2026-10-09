# Fluxo Operacional Completo — Assessoria de Cobrança IA

## 1. Objetivo

Criar uma operação de cobrança humanizada, multicanal e auditável, usando WhatsApp, e-mail e ligação/tarefa de call center, com agente de IA para responder dúvidas, identificar intenção do cliente, negociar de forma segura e encaminhar para humano quando necessário.

## 2. Canais

### WhatsApp
- Canal principal de contato.
- Mensagens curtas, humanizadas e sem pressão abusiva.
- Presença de “digitando” antes de enviar resposta.
- Pausa de 4 a 10 segundos para parecer natural.
- Respeito a horário permitido.

### E-mail
- Envio de notificação formal, segunda via, link de pagamento, acordo e confirmação.
- Usado principalmente a partir de D+3 ou quando WhatsApp não responde.

### Ligação
- Não é insistência automática infinita.
- O fluxo cria tarefa ou aciona provedor de voz quando a régua permitir.
- Deve respeitar limite diário/semanal e horário configurado.

## 3. Etapas da cobrança

### Pré-vencimento
- Lembrete educativo antes do vencimento.
- Sem tom de inadimplência.
- Oferta de segunda via/link.

### D0 a D2 — atraso recente
- Abordagem leve.
- Pergunta se deseja link/Pix atualizado.
- Evita falar de penalidades no primeiro contato.

### D3 a D6 — lembrete com e-mail
- WhatsApp + e-mail.
- Pergunta se houve imprevisto ou se precisa de uma alternativa.
- Abre caminho para negociação.

### D7 a D14 — negociação
- Oferece pagamento à vista, Pix, boleto, entrada + parcelas, data de promessa.
- Pode criar tarefa de ligação.
- Se houver dificuldade financeira, encaminha para negociação humana ou regra comercial.

### D15 a D29 — análise interna
- Tom formal, sem ameaça.
- Solicita retorno para evitar encaminhamento administrativo.
- Se o cliente contesta, trava cobrança e abre tarefa.

### D30+
- Entra em fila de revisão humana/legal/administrativa.
- IA não ameaça negativação, processo ou protesto.
- Qualquer medida externa exige validação humana e política do credor.

## 4. Intenções que o agente reconhece

- Já paguei / tenho comprovante.
- Não reconheço a dívida.
- Quero negociar.
- Posso pagar em data futura.
- Quero boleto/Pix/link.
- Estou sem condições.
- Quero falar com atendente.
- Advogado/Procon/reclamação.
- Parar mensagens / opt-out.
- Dados incorretos.

## 5. Regras de pausa e digitando

- Para WhatsApp, antes da mensagem final, o fluxo chama endpoint de presença/composing.
- Depois aguarda entre 4 e 10 segundos conforme tamanho da resposta.
- Mensagens longas são bloqueadas; o agente deve responder em até 3 blocos curtos.

## 6. Regras de bloqueio automático

O fluxo não envia cobrança se:

- Está fora do horário permitido.
- O cliente pediu para parar contato.
- Existe contestação aberta.
- O cliente informou pagamento ou enviou comprovante.
- A dívida está paga, cancelada ou em revisão.
- O limite de tentativas do dia/semana foi atingido.
- A mensagem gerada contém termo abusivo, ameaça ou exposição indevida.

## 7. Escalonamento humano

Abre tarefa humana quando:

- Cliente contesta a dívida.
- Cliente envia comprovante.
- Cliente pede atendente.
- Cliente menciona advogado, Procon, reclamação ou processo.
- Cliente informa vulnerabilidade/situação sensível.
- O acordo foge da política comercial.
- Há risco de duplicidade, cobrança indevida ou erro cadastral.

## 8. Banco de dados

O banco registra:

- Empresas/tenants.
- Credores/contratantes.
- Devedores.
- Dívidas.
- Acordos e parcelas.
- Interações por canal.
- Contadores de tentativa.
- Eventos de pagamento.
- Tarefas humanas.
- Webhooks brutos.
- Auditoria.

## 9. Integrações previstas

- Supabase/PostgreSQL.
- Evolution API ou provedor de WhatsApp compatível.
- OpenAI para geração humanizada da resposta.
- Provedor de e-mail transacional.
- Provedor de voz/call center.
- Webhook para CRM, Slack, painel interno ou fila humana.

## 10. Checklist antes de produção

- Revisar contrato com credores.
- Validar base legal e política de privacidade.
- Configurar opt-out e canal de atendimento humano.
- Testar mensagens com números internos.
- Homologar régua de cobrança por cliente/credor.
- Configurar limites por dia/semana.
- Configurar monitoramento de falhas.
- Treinar equipe humana para tratar escalonamentos.
