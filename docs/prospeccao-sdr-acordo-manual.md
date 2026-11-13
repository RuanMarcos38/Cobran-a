# Cobran-a — retomada de prospecção, API SDR e acordo manual

Escopo: R&R Estratégia e Performance / projeto Cobran-a. Nenhuma alteração de banco ou deploy de produção é feita ao acrescentar este documento.

## Diagnóstico de prospecção (revisão do código)

A rota POST /api/v1/commercial_prospection aceita as ações externas `health`, `mirror` e `dispatch` mediante `X-Integration-Key`. O disparo depende de uma chamada periódica externa e do espelho de leads atualizado. A fila exige `last_seen_at` recente (janela de cerca de 20 minutos), credor/tenant ativo, aprovação, verificação e ausência de bloqueio por tentativa incerta.

Foi corrigido o acoplamento do backend: falha na verificação IMAP, MX ou WhatsApp não impede que o ciclo tente o SMTP. As etapas de envio, automação e retorno de atualizações da planilha agora têm falhas independentes.

**O que não foi confirmado**: status operacional do n8n, horário do último espelho, chave configurada, credenciais SMTP/IMAP, política e limites do provedor em produção, motivo exato da pausa anterior e conclusão do deploy.

### Procedimento de retomada 24 horas, todos os dias

1. Conferir no painel Prospecção se a conexão está ativa, `paused=false` e a conta SMTP é a conta comercial correta. Não rodar envios sem uma lista B2B legítima e mecanismos de descadastro.
2. No n8n, conferir o workflow de espelhamento dos leads (Google Sheets) e o token da conexão. O espelho deve atualizar o backend pelo menos a cada 15 minutos; sem isso, a fila pode permanecer vazia por expiração de `last_seen_at`.
3. Importar `workflows/prospeccao-comercial-24x7.json` e configurar no próprio n8n as variáveis seguras `COBRANCA_PROSPECTION_URL=https://financeiro.rrestrategiaperformance.com.br/api/v1/commercial_prospection` e `COBRANCA_PROSPECTION_TOKEN` (token atual da integração; nunca escrever valor em repositório).
4. O agendamento roda a cada **15 minutos, 24 horas por dia, 7 dias na semana**, respeitando a janela móvel de 24 horas, o limite configurado no banco e supressões de contatos.
5. Testar antes: `health`; `mirror` sem mudar registros anteriores; `dispatch` único, verificando apenas um resultado confirmado pelo servidor SMTP. Se retornar `review` ou houver tentativa incerta, não repetir manualmente sem conciliação.
6. Conferir os logs das execuções e a atualização da planilha. Ativar o fluxo no n8n apenas após confirmar as credenciais e conexão de origem, sem rotacionar tokens existentes.

## API de integração com SDR e cobrança

Rota **POST /api/v1/contact_events**, documentada em `openapi.json`.
Autenticação: `X-Integration-Key`, gerada em Cadastro > Integrações / API por carteira de credor.
Esta rota **não envia mensagens nem faz ligações**; ela recebe eventos já realizados por outros sistemas com isolamento por credor e idempotência por `external_id`. Para executar comunicações, as ferramentas conectadas devem usar os provedores já autorizados e registrar retorno neste endpoint.

Exemplo (sem dados pessoais):

```http
POST /api/v1/contact_events HTTP/1.1
Content-Type: application/json
X-Integration-Key: <CHAVE_PRIVADA_DA_CARTEIRA>

{
  "external_id": "sdr-call-001",
  "debt_id": "<UUID_DE_TITULO_DA_CARTEIRA>",
  "channel": "voice",
  "direction": "outbound",
  "status": "registered",
  "subject": "Tentativa de contato",
  "content": "Registro de contato efetuado; sem detalhes financeiros enviados a terceiros."
}
```

Canais aceitos: `voice`, `whatsapp`, `email` e `human`. A mesma chave não acessa títulos de outros credores. A aplicação rejeita identificador repetido com conteúdo diferente e registra evento idempotente no banco.

Não criar integração pública anônima ou colocar chave no frontend.

## Instrumento de acordo: ELISATEX MALHAS LTDA x MM CONFECÇÃO

Valor principal reconhecido: **R$ 180.507,76**. Entrada informada como paga em **30/10/2026: R$ 5.000,00**. Saldo principal remanescente: **R$ 175.507,76**. Juros, correção e demais encargos permanecem fora do cronograma e requerem negociação separada.

Após a entrada, são **36 pagamentos**: 35 de R$ 5.000,00 e um final de R$ 507,76.

- 15 e 30 de cada mês de novembro/2026 a fevereiro/2027, ajustando 30/02 para **28/02/2027**.
- A partir de março/2027, dias 10, 20 e 30, até a última parcela em **10/12/2027**, de R$ 507,76.
- Nenhum pagamento deve ser cadastrado retroativamente sem comprovação; a entrada de 30/10/2026 precisa já estar conciliada e abatida no financeiro. Não duplicar recebimento.
- Para formalizar, selecionar os títulos corretos do mesmo devedor e credor, consultar a cotação do motor financeiro, conferir que o saldo do **principal restante** corresponde a R$ 175.507,76 e que os encargos não estão incluídos no acordo, editar as parcelas, registrar aceite e confirmar em tela. **O modelo recusa saldo divergente** e não efetua ajustes unilaterais.
- A migração `049-manual-variable-installments.sql` mantém todos os acordos de parcelas iguais já existentes; valida o total em centavos quando `installment_amounts` for informado.

## Implantação e aceite

1. Executar migrações **049** e **050** em homologação, após verificar sequência e backup, e confirmar que a SQL atual é compatível.
2. Executar GitHub Actions e testes de regressão do motor financeiro, prospecção e integração; falhas devem impedir a implantação.
3. Publicar a branch efetivamente configurada no EasyPanel após confirmar a origem do deploy, nunca assumir que ela aponta para `codex/saas-cobranca`.
4. Validar com um evento de teste API de um título autorizado, uma simulação de acordo sem formalização e um disparo individual da fila devidamente autorizada.
5. Conferir prevenção de duplicados, logs, permissões e rollback.
