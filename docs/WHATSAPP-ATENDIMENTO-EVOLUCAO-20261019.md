# Atendimento WhatsApp / Evolution — validação da alteração de 19/10/2026

## Escopo e compatibilidade
- Branch de trabalho baseada em `fix/importacao-elisatex-regras-financeiras-20261019`, que preserva todas as correções da PR #8.
- Não foram modificadas credenciais, tenants, variáveis do EasyPanel ou o banco de produção.
- Preservados cadastros, agendas, contratos, recebimentos, honorários, anexos, áudio, histórico e permissões de acesso.

## Estado e QR Code
- A fonte autoritativa para indicar conexão é a Evolution API, endpoint `instance/connectionState`; exigir `state=open`.
- Quando conectada, o Atendimento mostra "WhatsApp conectado" e não exibe o botão ou QR Code.
- Após o pareamento pelo QR, a tela consulta o status a cada 3,5 segundos enquanto o diálogo permanecer aberto, fecha o QR e retira o botão ao receber estado `open`.
- A verificação temporária para quando o diálogo fecha ou ocorre falha de consulta.
- A instância existente não é substituída, recriada ou desconectada pelo ajuste visual.
- Chave da API continua exclusivamente no servidor, protegida com o mecanismo criptográfico anterior.

## Interface
- Conversas na coluna esquerda, mensagens à direita; cabeçalho e barra de composição fixos dentro do painel.
- Altura responsiva, rolagem do histórico independente, bolhas de mensagem e identificação visual de conversa ativa.
- Campo cresce até limite; Enter envia e Shift+Enter cria uma quebra de linha.
- Enquanto `state=open`, o botão mostra `Enviar pelo WhatsApp`. A ação do usuário salva mensagem de forma idempotente, obtém ID do registro e solicita o envio externo à Evolution. Na ausência de conexão, apenas salva o histórico interno e informa isso.
- A aceitação pelo provedor **não** confirma entrega nem leitura no dispositivo do destinatário.
- Mensagens antigas com status interno conservam o botão individual de envio; mensagens sem confirmação exigem verificação antes de novo envio, para evitar duplicidade.

## Taxas escalonadas
- A classificação de honorários continua no banco PostgreSQL, por vencimento original e entrada da carteira, em cinco faixas: 1-30, 31-90, 91-180, 181-365 e acima de 365 dias.
- As taxas iniciais são 10%, 15%, 20%, 25%, 30%, mas cada versão contratual pode configurar outras taxas.
- A prévia de vinculação agora mostra a faixa de cada título e a taxa-base aplicável, sem lançar valor.
- A taxa efetiva sobre recebimento continua sendo calculada pelo trigger de honorários com desconto por volume, piso contratual e histórico congelado; **não é juro contratual do devedor**.
- Títulos não vencidos têm taxa-base zero. Ausência de contrato/classificação exige regularização antes do cálculo de honorários. Nenhuma cobrança é disparada automaticamente.

## Testes
- `npm test`: testes da Evolution com respostas simuladas (status, QR, permissões, chave oculta, envio, idempotência) e enquadramento visual das cinco taxas.
- GitHub Actions: testes locais de banco de dados, precificação e sistemas legados. Nenhum contato recebe mensagens reais nos testes.
- Para validar produção, é necessário confirmar qual commit/branch o EasyPanel atende, consultar status real da Evolution com uma sessão autenticada, enviar mensagem **somente a um número de teste autorizado**, confirmar no provedor e validar o recebimento no celular.
- O histórico atual **não implementa webhook de mensagens recebidas**. Conversa totalmente bidirecional só pode ser declarada funcional após implementação, configuração e teste desse webhook.
- Nenhum login, token ou chave deve ser enviado aos logs ou registrado nos commits.

## Implantação
1. Confirmar que as migrações necessárias ao código-base (incluindo PR #8, quando implantada) estão aplicadas no **banco correto**; manter backup e verificar compatibilidade com a versão em produção.
2. Conferir PR e testes verdes; integrar pela ordem correta de branches.
3. Publicar no serviço EasyPanel **r2rmarketingdigital/cobranca** sem alterar volumes, domínios, ambientes ou variáveis.
4. Inspecionar `/health` e executar fluxo de QR/status/envio usando credenciais existentes; em caso de qualquer problema restaurar commit anterior, sem apagar histórico de banco.
