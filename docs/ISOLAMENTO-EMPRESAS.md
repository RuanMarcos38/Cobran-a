# Empresas independentes na mesma ferramenta

Cada empresa utiliza um ambiente lógico próprio. Administradores da empresa gerenciam somente seus usuários e dados; não têm acesso às demais empresas.

## Cadastrar uma nova empresa

1. O responsável usa **Criar meu acesso** com um e-mail próprio e confirma esse e-mail.
2. No primeiro acesso, sem convite existente, escolhe **Cadastrar minha empresa** e informa o nome da empresa.
3. O sistema cria uma empresa vazia e vincula o responsável como administrador. O navegador não escolhe nem reaproveita o identificador de outra empresa.
4. Em **Minha empresa**, completa seus dados. Em **Usuários**, cadastra os integrantes da própria equipe. Os integrantes devem usar o e-mail convidado para criar e confirmar o acesso; não devem criar outra empresa.
5. Configura suas próprias caixas de e-mail, números de WhatsApp, contas bancárias e integrações. Contas e credenciais da RR não são copiadas para novos clientes.

Cada acesso pertence a uma empresa. Um usuário existente não é transferido por alteração de identificador ou cadastro de cliente credor. Para outra empresa, use um responsável com e-mail ainda não vinculado ou convidado.

## Proteções

- Consultas, cadastros, exportações, relatórios, documentos, títulos, negociações, CRM, financeiro e atendimento são autorizados pela empresa do usuário autenticado.
- Tabelas não oferecem acesso direto ao navegador; as operações passam pelas funções autorizadas. Todas as tabelas da aplicação têm RLS.
- Vínculos entre registros de empresas distintas são rejeitados pelo banco. Equipes de atendimento e distribuição não podem incluir usuários de outra empresa.
- A empresa proprietária de um registro não pode ser alterada. Regras financeiras, cadastros e integrações existentes são preservados.
- Tokens de integração identificam sua própria empresa; um identificador enviado no conteúdo não permite escolher outra.

A migração 034 acrescenta restrições e proteções, sem copiar ou reatribuir dados existentes. A recuperação correspondente está em `database/rollback/034-tenant-isolation-integrity.sql` e não exclui dados de negócio. Testes de isolamento e reversão rodam em `tests/tenant-isolation.local.mjs`.
