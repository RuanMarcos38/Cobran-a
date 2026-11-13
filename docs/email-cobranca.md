# Cobranças por email na tela do processo

Na área Processo → Cobrança, o administrador encontra **Configurar email**. A configuração usa cobranca@rrestrategiaperformance.com.br, smtp.hostinger.com, porta 465 e TLS. Informe a senha da caixa postal, nunca a senha do hPanel. O sistema testa a autenticação sem enviar mensagens e só então salva a configuração da empresa.

A senha é criptografada com AES-256-GCM no servidor, vinculada ao identificador da empresa. A chave `EMAIL_ENCRYPTION_KEY` deve conter 64 caracteres hexadecimais e ficar apenas no ambiente do servidor. Faça backup seguro dessa chave: perdê-la exige configurar a senha novamente. Ela não é enviada ao navegador, ao repositório ou aos logs. A configuração criptografada e os envios ficam em tabelas privadas, com RLS e sem acesso direto de anon/authenticated. A extensão SQL é `database/016-email-cobranca.sql`, aplicada depois da estrutura existente; ela não substitui a API ou os cálculos financeiros.

Abra um processo na consulta. Na aba Processo, clique **Enviar cobrança por email**, escolha o modelo e gere a prévia. Confira devedor, email, credor, saldo, vencimento e mensagem. O envio exige confirmação explícita. O histórico de atendimento recebe o conteúdo, operador, modelo, referência da aprovação jurídica, estado do SMTP e identificador da mensagem.

Os seis modelos incluem primeiro contato, lembrete, negociação, retorno combinado, comunicação extrajudicial e ajuizamento aprovado. Apenas administradores podem selecionar o modelo de ajuizamento e precisam registrar o responsável jurídico e a referência da aprovação real. Não há seleção automática desse modelo por atraso.

Prévia válida por 15 minutos. Alteração dos dados exige nova prévia. Uma prévia só pode ser usada uma vez. Há um limite conservador de uma tentativa aceita ou incerta por processo em 24 horas. Títulos quitados, suspensos, devolvidos, encerrados, contestados ou com revisão humana obrigatória ficam bloqueados.

`aceito_smtp` significa aceitação pela Hostinger, não comprova entrega ou leitura. Respostas e devoluções precisam ser acompanhadas na caixa postal. `incerto` ou `enviando` exigem conferência antes de nova tentativa; não há repetição automática. O módulo não executa envios ao cadastrar borderô nem disparos em massa.

Validação local: `node --test tests/*.test.mjs`, `node tests/email.local.mjs` e `node tests/database.local.mjs`. Nenhum desses testes envia emails reais.

Para reverter o aplicativo, restaure a imagem anterior no painel de implantação. As tabelas adicionais podem permanecer sem interferir no sistema anterior; preserve o histórico e não exclua dados para reverter a interface.
