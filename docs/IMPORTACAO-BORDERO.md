# Borderôs por arquivo — revisão de 16/10/2026

## Uso

Em **Processo → Carteiras de credores**, selecione o credor e clique em **Importar borderô XLS / PDF**. Gestores, administradores e master podem importar. Selecione um arquivo de até 5 MB, leia a prévia e confirme. A integração por token/API e a importação CSV de cadastros continuam separadas e preservadas.

- XLS e XLSX: cabeçalho do modelo fornecido, com as 23 colunas; tolera espaços, acentos, ordem das colunas e cabeçalhos equivalentes cadastrados em `bordero-parser.mjs`. Todas as abas preenchidas são conferidas. Planilha somente com cabeçalho informa que não há títulos para importar.
- PDF: relatório textual no padrão “Baixa por Lote Títulos Receber com Composição”, com número do título, código do cliente, razão social, vencimento e valor aberto. Observações e série NF ficam separadas. Quantidade e total geral precisam coincidir com os títulos extraídos; subtotais e rodapés não viram dívidas.
- CPF/CNPJ e telefone nunca são inventados. Na ausência de documento, o código do devedor é identificado **dentro do credor e da empresa**, sem usar o nome como identificador único. Se já houver devedor sem esse código, confira o cadastro antes de importar: a ferramenta não deduz identidade só pelo nome.
- Endereço, bairro, cidade, UF, CEP, contatos, representante, espécie, emissão, parcela, observações e valor de protesto ficam preservados. Os dados originais podem ser consultados em **Dados do borderô importado** no processo. O valor de protesto é informativo, sem somá-lo automaticamente ao saldo.
- O valor em aberto recebido abre o processo nesse valor; não é possível recuperar o valor histórico original de uma dívida quando o arquivo só informa o saldo aberto.
- Cada parcela tem referência própria. Título já existente com mesmo devedor, valor de entrada e vencimento é reconhecido sem alterar saldo, pagamentos ou situação. Divergência bloqueia o lote inteiro. Reenviar um arquivo não reabre dívida paga.
- Dados de contato já existentes e restrições de atendimento são preservados. Dados ausentes podem ser preenchidos. Não há disparo de cobrança nesta importação.
- O CNPJ/nome do credor informado no arquivo precisa corresponder à carteira escolhida. Encargos usam as regras contratuais existentes e exigem referência de contrato quando aplicável. A distribuição automática existente continua funcionando.
- Cada lote grava hash, nome do arquivo, linha de origem, campos originais e auditoria; o arquivo binário não é armazenado. “Títulos Captados” inclui arquivos e integração API.

Layouts diferentes dos reconhecidos, PDFs escaneados/imagens, relatórios sem totais, linhas ambíguas e dados inválidos são rejeitados para conferência. Não há OCR nesta entrega. Limites: 1.000 títulos por arquivo, 100 páginas por PDF, 5.000 linhas por aba, duas leituras simultâneas e 20 segundos por leitura. Nenhum registro do lote é gravado se houver erro na confirmação.

## Instalação na aplicação existente

1. Aplicar **uma vez** `database/015-file-borderos.sql` no banco exclusivo desta aplicação, depois das migrações 001–014. A migração é transacional, aditiva e não altera credenciais nem registros existentes. Não executar novamente os scripts antigos.
2. Publicar o código desta branch com `npm ci --omit=dev --ignore-scripts` ou reconstruir o Dockerfile atualizado. O servidor agora precisa das bibliotecas fixadas de leitura XLS/PDF; `npm start` continua com as variáveis existentes.
3. Homologar com um usuário gestor da própria empresa, fazer leitura/prévia, confirmar um lote aprovado e reimportá-lo para conferir as duplicidades.

Não aplicar no ERP Ecojoi ou em outro projeto. Não é necessário criar token de integração, trocar URL/chave pública ou inserir service-role.

## Verificação executada

- 15 testes automatizados Node aprovados: valores, centavos, CSV, sessão, autenticação HTTP, acesso à carteira antes da leitura do arquivo, XLS/XLSX, cabeçalhos, telefone/documento, datas, PDF, totais e formatos inválidos; integrações WhatsApp testadas com simuladores.
- Quatro suítes PostgreSQL local aprovadas: cadastros/permissões, setores/CRM/WhatsApp/relatórios, financeiro/ERP e nova importação. Incluem isolamento por empresa/credor/perfil, rollback integral, reimportação, conflito, preservação de contatos/bloqueios e distribuição.
- PDF fornecido: 14 títulos, **R$ 180.507,76**, sem erro de reconciliação; inserção local e reimportação conferidas. Os dados do cliente não foram adicionados ao GitHub.
- XLS fornecido: modelo vazio reconhecido. Um registro sintético preenchido no próprio modelo confirmou o mapeamento e a preservação das **23 colunas** até o banco.
- Consulta de integridade de dependências em execução: nenhum aviso de vulnerabilidade reportado pelo `npm audit --omit=dev` nesta data.
- Endpoint público `/health` respondeu HTTP 200 e indicou banco configurado; isso não valida login nem operações de produção.

## Limitações da auditoria

Os testes de banco usam PostgreSQL WASM/PGlite e substituem o Supabase Auth por uma identidade de teste. Não executam provedores reais, pagamentos, envios, nem login com conta real. O navegador Chrome conectado retornou `Sheep MCP session closed: RPC INTERNAL`; não foi possível fazer a varredura visual autenticada nesta sessão. A consulta de diagnósticos do projeto Supabase indicado pela documentação foi recusada por falta de permissão na conexão disponível. Não houve alteração no banco hospedado nem publicação em produção.

Não foram reproduzidas falhas adicionais nas suítes existentes. A correção principal cobre a ausência de importação XLS/PDF e a exclusão desses títulos no relatório de captação. Esta revisão não certifica ausência de falhas em todo o sistema; a homologação autenticada e a instalação acima continuam pendentes.

## Repetir os testes

```bash
npm ci
npm test
node tests/database.local.mjs
node tests/sectors.local.mjs
node tests/finance.local.mjs
node tests/borderos.local.mjs
```

Opcionalmente, apontar `BORDERO_PDF` e `BORDERO_XLS` para os anexos locais ao executar `tests/borderos.local.mjs`. Os registros são criados apenas no banco temporário do teste.
