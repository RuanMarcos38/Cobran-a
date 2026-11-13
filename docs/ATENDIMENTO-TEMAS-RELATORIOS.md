# Atendimento, temas e relatórios — Cobrança

Atualização de 10/10/2026 no projeto existente. Nenhuma carteira ou empresa foi substituída.

## Atendimento comercial

Em Comercial → Atendimento, selecione a oportunidade. O histórico anterior continua disponível. Digite mensagens, use Emojis, anexe PDF, PNG/JPEG, TXT, CSV ou áudio MP3, WAV, OGG/Opus e WebM. Limite: 5 MB por anexo. A gravação requer HTTPS e autorização do microfone; para finalizar, clique em Parar gravação. Limite de gravação: dois minutos. Salvar mensagem registra o histórico interno.

Os anexos são privados, sem endereço público. Cada leitura e download verifica empresa, perfil e responsável da oportunidade. Gestor de cobrança, negociador, financeiro e cliente credor continuam sem acesso ao setor Comercial.

## WhatsApp real / Evolution API

O conector de saída está implementado no backend, com texto, emojis, imagem, documento e áudio. O envio usa exclusivamente o telefone da oportunidade autorizada. Credenciais ficam no servidor e cada configuração é vinculada explicitamente a uma empresa.

A ativação real está pendente: o proprietário informou que ainda não possui um número para conectar. Não há instância conectada ou credenciais configuradas no Cobrança. O serviço Evolution API existente foi identificado no EasyPanel; nenhum serviço Evolution, PostgreSQL ou Redis foi substituído ou recriado.

Para ativar, um responsável deverá conectar um número comercial a uma instância Evolution e cadastrar no ambiente **somente do serviço cobranca** a variável secreta WHATSAPP_CONNECTIONS_JSON. Estrutura: objeto cuja chave é o UUID da empresa, contendo url, instance e apikey. Usar a rede interna para uma Evolution hospedada no mesmo servidor ou HTTPS válido para um provedor externo. Nunca cadastrar a chave no navegador ou no repositório. Empresas sem configuração ficam bloqueadas; não existe conexão global compartilhada por padrão.

Após configurar e implantar, o sistema consulta /instance/connectionState. O botão Enviar pelo WhatsApp só fica habilitado com instância aberta. Salvar no sistema e enviar ao WhatsApp são ações distintas. O status “Aceito pela Evolution” exige identificador retornado pelo provedor; não significa entregue ou lido pelo destinatário. Um envio sem confirmação fica bloqueado contra repetição automática e precisa de conferência na Evolution.

**Limitações atuais:** o conector de saída foi testado com respostas controladas, não com WhatsApp real. Recepção de respostas, webhook de entrega/leitura e mídia recebida ainda não foram implementados/homologados. Portanto este recurso não deve ser apresentado como um WhatsApp bidirecional completo.

## Claro e escuro

Botão no cabeçalho e na tela de entrada. A escolha fica salva neste navegador; na primeira visita segue a preferência do dispositivo. A impressão utiliza fundo branco, mesmo no tema escuro.

## Relatórios

Atualizar, Aplicar período, Exportar CSV e Imprimir/PDF permanecem disponíveis conforme permissões. Todos os nove relatórios foram exercitados no navegador de homologação. Datas invertidas são rejeitadas no frontend e backend.

Títulos Captados mostra títulos recebidos pela integração de borderôs. Análise Gerencial agrupa quantidade e valores por situação. Clientes Inativos e E-mail de Clientes respeitam a data de cadastro. Recebimentos usam data de pagamento e histórico usa data do atendimento. Os indicadores de carteira seguem a data de cadastro dos processos; recebimentos e honorários seguem a data de pagamento. Estornos continuam discriminados nos resultados. O acesso e os dados respeitam o perfil e a empresa.

## Operação

Domínio: https://financeiro.rrestrategiaperformance.com.br/
Serviço: r2rmarketingdigital/cobranca.
Banco: projeto Supabase makpnbqtebtyrqyqdbru.
Migração aditiva: 014-chat-reports.sql. Não executar novamente numa base onde já foi aplicada.

O relatório de validação descreve o que foi efetivamente testado e as pendências externas; não representa garantia universal de ausência de falhas.
