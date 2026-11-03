# Credores, carteiras e integrações

O cadastro chamado anteriormente Clientes aparece como **Credores / Clientes**. É o mesmo cadastro, com os mesmos identificadores, contratos, dados e permissões. Não foi criada uma segunda base de clientes.

## Operação da assessoria

1. Em Cadastro › Credores / Clientes, inclua a empresa contratante da assessoria e as condições do seu contrato: juros, multa, carência e honorários.
2. Cadastre o devedor vinculado ao credor. Cadastre ou receba os títulos, com vencimento, valor, contrato e responsável.
3. Em Processo › Carteiras de credores, escolha o credor. A contagem e o saldo vêm da consulta autorizada no servidor, considerando todos os processos dessa carteira. O botão de consulta aplica o identificador do credor e a situação Todos à tela Cobrança.
4. Negociadores continuam com acesso apenas aos seus processos; o portal credor continua vinculado ao credor autorizado. Comercial permanece separado da cobrança.
5. Acordos, recebimentos, honorários, comissões, repasses, histórico e estornos continuam nos fluxos existentes. Esta atualização não altera cálculos nem contratos.

## Integração sem comandos nesta plataforma

Cadastro › Integrações / API e Financeiro › Integrações ERP abrem a mesma configuração visual. Cadastrar credor abre o cadastro; Conectar credor / gerar chave cria um token para o credor selecionado. O token é mostrado uma única vez e tem botão de cópia. Gerar novamente para o mesmo credor revoga o token anterior.

O endereço de borderôs recebe os títulos. O endereço ERP recebe dívidas vencidas e baixas e oferece a fila de retorno de recebimentos e estornos. Configure o fornecedor e a versão pelo botão Configurar ERP. Como integrar abre orientações legíveis; o contrato OpenAPI permanece disponível como documentação técnica opcional.

O token **não dá consulta pública aos dados** e não serve para conectar qualquer ERP apenas informando seu nome. O fornecedor precisa enviar e ler os eventos no formato documentado. Sem um ERP configurado, a tela mostra **aguardando dados do credor**. Não foram criadas conexões fictícias em produção. Esta versão gera o token do Cobrança; não armazena uma chave externa de SAP/TOTVS/Senior nem presume endpoints ou mapeamentos desconhecidos.

## Atendimento

Nova conversa cadastra um contato na prospecção e abre a possibilidade de atendimento, sem exigir navegação prévia ao funil. A apresentação usa lista de contatos, avatares, cabeçalho, balões separados por autor, fundo de conversa e compositor, em temas claro e escuro e com adaptação móvel.

Emoji, anexos e gravação de áudio mantêm os mecanismos existentes. Salvar mensagem registra no histórico interno; Enviar pelo WhatsApp só funciona com a conexão Evolution configurada e um número ativo. O sistema não apresenta registro interno como mensagem entregue no WhatsApp. O recebimento de conversas do WhatsApp por webhook ainda não está implementado; não se trata de uma cópia funcional completa do WhatsApp.

## Preservação

Nenhuma tabela, migração, perfil, regra de acesso ou fórmula financeira foi modificada nesta atualização. Os testes usam banco local isolado, sem registros de teste na produção. A publicação mantém o serviço r2rmarketingdigital/cobranca e o domínio existente.
