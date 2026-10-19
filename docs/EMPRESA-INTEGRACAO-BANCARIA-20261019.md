# Cadastro da empresa e integração bancária — Cobran-a

## Funções adicionadas
- **Cadastro → Minha empresa**: razão social, CNPJ válido, fantasia, inscrição, e-mail, telefone, responsável e endereço da empresa que utiliza o sistema.
- O fluxo original de **Cadastrar minha empresa** permanece disponível no primeiro acesso; cada empresa tem seu próprio tenant e cadastro financeiro.
- **Financeiro → Conciliação bancária**: cadastro existente da conta e importação/baixa de extratos são preservados.
- **Financeiro → Integração bancária / Boletos**: escolha da conta cadastrada, código COMPE, instituição, agência, conta, CNPJ beneficiário, convênio, carteira, chave PIX, ambiente e provedor.
- Credenciais Client ID, Client Secret e API Key do banco são enviadas exclusivamente ao backend autenticado e armazenadas criptografadas com AES-256-GCM e AAD específico de tenant+integração, usando a chave protegida já configurada no servidor.
- Apenas administrador/mestre podem alterar dados e credenciais. Financeiro pode consultar informações não sensíveis; outros perfis não têm acesso. Identidade corporativa, bancos e dados de credores são isolados por tenant.
- Mudanças de provedor/banco invalidam credenciais anteriores e impedem emissão inadvertida. Toda alteração é auditada.

## Limitação intencional
Esta versão **NÃO emite boletos automaticamente**, **NÃO baixa boletos** e **NÃO declara conexão bancária homologada**. A API oficial precisa ser escolhida para o banco contratado. A ação "Verificar prontidão" só confirma configuração interna protegida; não simula autenticação real. A operação `bank_issue` rejeita qualquer solicitação até existir um adaptador bancário homologado. Não existe geração de PDF ou linha digitável falsa.

## Para efetivar o banco
1. Confirmar banco emissor: instituição, código COMPE, convênio de cobrança, carteira, conta/beneficiário e se possui acesso à API de boletos.
2. Obter credenciais emitidas pelo banco, escopos, certificado mTLS (quando exigido), conta homologada e endpoint oficial. Guardar segredos fora de commits.
3. Criar adaptador **apenas para esse banco** com chamadas autorizadas para criar, consultar e cancelar boletos. Confirmar identificador bancário, nosso número, código de barras, linha digitável, PDF/URL oficial e idempotência do pedido.
4. Validar webhook autenticado e conciliação de liquidações/estornos sem duplicar baixas. Exigir assinatura/documentação oficial e trilha de auditoria.
5. Testar primeiro em homologação com números de teste autorizados; somente após aprovação bancária liberar produção por empresa/conta.

## Publicação sem perda
- A nova migração `database/022-company-bank-settings.sql` é aditiva; depende das migrações 020 e 021 das PRs anteriores.
- Preservar ordem: **PR #8, #9, #10, #11**. Testar todas juntas antes de atualizar o serviço EasyPanel `r2rmarketingdigital/cobranca`.
- Banco Supabase usado pelo domínio precisa ser identificado e ter migrações 020 → 021 → 022 aplicadas em ordem, após backup. Os dois conectores Supabase disponíveis nesta conversa **não listaram** o projeto historicamente identificado como `makpnbqtebtyrqyqdbru`.
- **Não mesclar na branch atualmente publicada** se as migrações não estiverem confirmadas: atualização de interface sem backend correspondente pode apresentar erro de RPC. O código ainda não foi publicado em produção.
- Não sobrescrever variáveis, sessão, volumes, DNS, certificados, n8n, credenciais Evolution, dados de credores, banco ou recebimentos antigos.

## Testes
- `tests/company-bank.local.mjs`: cadastro CNPJ, conta, edição de integração, troca de provedor, não emissão, permissão e isolamento de tenants.
- `tests/bank.test.mjs`: criptografia AAD por empresa, proteção das credenciais e proibição de confirmação falsa.
- GitHub Actions mantém todas as regressões do CRM, n8n, precificação, importação e financeiro existentes.
