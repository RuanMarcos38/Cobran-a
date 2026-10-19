# Cobrança por email — módulo local

## Inicialização pronta no Windows

Abra `Abrir-cobranca.cmd`. Na primeira abertura, informe a senha da caixa postal na janela local (entrada protegida). O assistente testa a autenticação SMTP sem enviar email, salva a credencial criptografada pelo Windows em `smtp-credencial.xml` e abre a tela no navegador. Nas próximas aberturas, reutiliza a credencial. Ela só pode ser descriptografada pelo mesmo usuário Windows neste computador. O arquivo é excluído do Git e não acompanha o pacote entregue. Para trocar a senha, feche o módulo e remova somente esse arquivo antes de abrir novamente.

O teste confirma conexão e autenticação, não entrega de mensagens. O envio continua exigindo revisão e confirmação na tela. Mantenha a janela do módulo aberta durante o uso.

Módulo adicional independente, sem alterar o workflow n8n, o banco Supabase ou os arquivos originais. Não existe uma tela anterior no repositório: esta é uma nova tela de cobrança. Os cadastros feitos aqui ficam no SQLite local; não são sincronizados com n8n ou outro sistema.

## Abrir

Requer Python 3.10 ou superior. No terminal, entre nesta pasta e execute:

```powershell
python app.py
```

Abra no navegador o endereço completo mostrado no terminal. Ele tem um código de acesso aleatório que muda a cada inicialização. O módulo aceita conexões apenas deste computador. Não compartilhe esse endereço. Fechar o terminal encerra o módulo.

## Configurar a Hostinger

Remetente e usuário SMTP: **cobranca@rrestrategiaperformance.com.br**.
Servidor: **smtp.hostinger.com**, porta **465**, TLS com validação de certificado.
Resposta para: a mesma caixa postal.

Confirme os dados da caixa em hPanel → Emails → Gerenciar → Conectar aplicativos/dispositivos. A senha necessária é a da caixa postal, não a senha do hPanel. Não grave a senha no código, no GitHub ou nesta documentação.

Para iniciar com a senha apenas na sessão atual do PowerShell:

```powershell
$smtpSecret = Read-Host 'Senha da caixa de email' -AsSecureString
$smtpCredential = [System.Net.NetworkCredential]::new('', $smtpSecret)
$env:SMTP_PASSWORD = $smtpCredential.Password
try { python app.py } finally { Remove-Item Env:SMTP_PASSWORD -ErrorAction SilentlyContinue }
```

O aplicativo recebe o segredo pelo ambiente. Sem ele, cadastro e prévia funcionam, mas o envio fica bloqueado. Os registros de autenticação do domínio devem ser conferidos no hPanel. Nenhuma configuração DNS ou de conta foi alterada por este pacote.

Documentação do provedor: https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/

## Usar a tela

1. Cadastre o título, borderô, empresas envolvidas e email conferido do próprio devedor.
2. Busque por devedor, título ou borderô.
3. Escolha um dos seis modelos e identifique o operador.
4. Informe prazo de resposta quando o modelo solicitar.
5. Para ajuizamento, registre o responsável e a referência da autorização real. Esse modelo nunca é selecionado automaticamente por atraso.
6. Gere a prévia. Confira destinatário, valores, datas e conteúdo.
7. Marque a confirmação e envie. O histórico registra modelo, operador, texto, autorização e identificador da mensagem.

Use um título de teste com seu próprio endereço antes de cadastrar destinatários reais. Não há envio automático ao cadastrar, disparo em massa ou execução de IA. Os textos já estão incluídos e não geram custo de API.

## Estados e limites

- Títulos quitados, contestados ou suspensos não podem gerar cobrança.
- Se o título mudar depois da prévia, o envio exige nova prévia.
- Uma prévia só pode ser enviada uma vez. Há limite conservador de uma tentativa aceita ou incerta por título no dia UTC.
- `aceito_smtp` indica aceitação pelo servidor, não entrega nem leitura. Respostas e devoluções precisam ser acompanhadas na caixa postal.
- `incerto` pode significar falha ou aceitação sem confirmação. Não há retentativa automática: confira a caixa postal. Se o processo cair durante o envio, `enviando` também exige conferência.
- O nome do operador e a aprovação são registros declarados localmente, sem validação de identidade. O módulo é para operação local por um responsável; não é um portal multiusuário.
- Antes de hospedar na internet ou integrar a um CRM, são necessários autenticação, permissões, política de retenção, tratamento de devoluções e sincronização dos títulos. Não publique a porta local.

## Preservação

O arquivo `cobranca-local.sqlite3` contém dados pessoais e o histórico. Mantenha-o em pasta protegida, com cópia de segurança. Ele e suas variantes são excluídos do Git pelo `.gitignore` deste módulo. O ZIP entregue não contém banco de dados, senha ou cadastros de teste.

## Verificação

```powershell
python -m unittest -v test_app.py
```

Os testes usam banco temporário e SMTP simulado. Autenticação e entrega reais na Hostinger ainda dependem da senha e de um teste operacional autorizado.
