# Prospecção e envios

A área Comercial → Prospecção reúne o espelho da planilha, aprovação individual, fila e histórico. O quadro de oportunidades continua disponível na segunda aba e em Funil / Kanban. As funções financeiras, credenciais e integração da Agenda não são alteradas.

## Operação

1. Administrador configura a conexão, escolhe a conta de e-mail **comercial já cadastrada**, a planilha e o responsável. A chave aparece uma vez e a fila começa pausada.
2. Guardar a chave numa credencial Header Auth do mesmo fluxo n8n, campo `x-integration-key`, restrita ao domínio da ferramenta.
3. A cada 15 minutos, o fluxo lê a planilha inteira e envia lotes de até 500 linhas / 900 kB para `POST /api/v1/commercial_prospection`, operação `mirror`. Só os 20 campos conhecidos são guardados; texto importado não é interpretado como instrução.
4. O fluxo chama `dispatch`. A **própria ferramenta** autentica a caixa comercial, reserva um contato no banco, envia uma mensagem e registra o resultado SMTP. O n8n não recebe a senha da conta comercial.
5. Apenas resposta `status: accepted` atualiza o status da linha existente na planilha. Uma falha posterior nessa atualização não libera reenvio: o banco mantém a reserva e o histórico.

O painel atualiza em 15 segundos, tem filtros e páginas de 100 contatos. Os totais abrangem os contatos visíveis ao usuário, independentemente do filtro. O espelho preserva o histórico de contatos removidos da planilha, mas contatos não vistos nela nos últimos 20 minutos não são enviados.

## Proteções

- Chave comercial própria; o token da Agenda não é ampliado. Conta comercial, responsável ativo e empresa devem corresponder.
- Tabelas privadas com RLS e negação de acesso direto. RPC autenticada verifica empresa, perfil e atribuição. Coletores e financeiro não acessam este painel.
- Aprovação exige B2B `SIM`, `status_email` `VERIFICADO`, fonte HTTPS, assunto e mensagem. A aprovação inclui identificação profissional e instrução de remoção. Texto aprovado fica registrado separadamente da planilha.
- Uma tentativa automática por e-mail por empresa, inclusive após importações repetidas. CNPJ contatado ou suprimido também bloqueia novos contatos. Bloqueios são permanentes nesta fila; importar `optout=NAO` não remove uma supressão anterior.
- Reserva durável e transação serializada pela conexão: uma execução não retira o mesmo lead de outra. Até 20 tentativas/dia em São Paulo e intervalo mínimo de 15 minutos, considerando também datas de contato importadas.
- `sending`/`unknown` bloqueiam a fila. Falha de SMTP ou de persistência não recebe tentativa automática adicional. A revisão operacional deve conferir caixa e histórico; não apagar tentativas nem reaprovar contatos para contornar o bloqueio.
- `accepted` confirma aceitação do destinatário pelo servidor SMTP, não entrega na caixa nem leitura. `reported` é exclusivamente histórico importado da planilha, sem fabricar comprovante SMTP.
- A prospecção é separada da cobrança. Não usa o remetente de cobrança nem altera contas, contratos, recebimentos ou credenciais existentes.

## API da integração

Cabeçalho: `x-integration-key`. Operações HTTP: `health`, `mirror`, `dispatch`. `sender` é reservado ao servidor HTTP. RPC interna também implementa `claim` e `finish` para a transação de envio; a integração nunca deve chamar esses passos em paralelo ao `dispatch`.

`mirror`: `{ "operation": "mirror", "sheet_id": "...", "rows": [{ "empresa": "...", "email": "..." }] }`.

`dispatch`: `{ "operation": "dispatch" }`. Retorna `idle` com motivo, `accepted` com identificadores, ou `review`. Somente `accepted` permite sinalizar ENVIADO na planilha.

## Implantação e validação

Migração aditiva `20261023202304_commercial_prospect_monitor.sql`, espelhada em `database/037-commercial-prospection.sql`. Não reexecutar uma migração já registrada. Uma reversão da interface deve preservar as três tabelas e seus registros; pausar a fila antes de reverter o código.

Testes: `node --test tests/*.test.mjs`, `node tests/prospection.local.mjs`, `node tests/attendance.local.mjs`. SMTP dos testes usa transportes simulados; nenhum teste novo deve enviar e-mails reais sem autorização específica.

O cadastro de reuniões/Meet e a pesquisa por uma API gratuita continuam dependendo das respectivas conexões. Este módulo não afirma que essas integrações estão conectadas nem ativa fontes não validadas.
