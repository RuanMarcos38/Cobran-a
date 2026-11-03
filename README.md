# Cobran-a

Aplicação de gestão de cobrança que preserva a organização visual da referência
fornecida. O pacote original de n8n continua no repositório.

**Status: desenvolvimento, sem deploy e sem homologação de produção.**
Consulte [status de implementação](docs/status-implementacao.md) para as pendências
do prompt completo. Não há dados financeiros fictícios na aplicação.

## Preparar ambiente

Node.js 22 ou superior. A aplicação não requer dependências em execução.

1. Criar um projeto Supabase separado. Não aplicar os scripts no ERP Ecojoi.
2. Executar os scripts de `database/` em ordem: esquema original, 002, 003 e 004.
3. Autorizar o e-mail administrativo conforme abaixo; o usuário cria sua senha na tela.
4. Copiar `.env.web.example` para `.env` e preencher URL e chave pública do projeto.
5. Executar `node --env-file=.env server.mjs` e acessar `http://127.0.0.1:3000`.

Nunca usar `service_role` em `SUPABASE_PUBLISHABLE_KEY` ou no navegador.
O `.env.example` original é do workflow n8n; permanece preservado.

### Primeiro administrador

O projeto indicado pelo usuário já recebeu o esquema e a autorização do e-mail
administrativo. Na tela, clicar em **Criar meu acesso**, cadastrar o endereço
autorizado, definir a senha, confirmar o e-mail e entrar. O banco atribui o perfil
administrativo somente ao endereço autorizado e confirmado. A autorização fica
em tabela privada e não depende de metadados editáveis pelo usuário.

Para uma implantação nova, autorizar o endereço no SQL Editor do projeto:

```sql
insert into cobranca_private.bootstrap(email,tenant_id)
values('SEU_EMAIL_AUTORIZADO','00000000-0000-0000-0000-000000000000');
```

Provisionamento manual alternativo:

Após criar o usuário com e-mail confirmado no Supabase Auth, executar no SQL Editor:

```sql
insert into public.cobranca_profiles(id,tenant_id,name,role,discount_limit)
select id,'00000000-0000-0000-0000-000000000000','Administrador','admin',100
from auth.users where email = 'SEU_EMAIL_CONFIRMADO';
```

O valor de alçada deve ser adequado à operação. Outros perfis são provisionados
por um administrador do projeto no banco: `master`, `admin`, `supervisor`,
`collector`, `finance`, `creditor`. O credor deve ter `creditor_id` da mesma assessoria.

## API

Supabase Auth: login via `/auth/v1/token?grant_type=password`, atualização de sessão
via refresh token e logout via `/auth/v1/logout`.

API de negócio: `POST /rest/v1/rpc/cobranca_app` com `{action,payload}`.
Ações: `profile`, `lookups`, `list`, `get`, `save`, `processes`, `new_process`,
`detail`, `status`, `history`, `agreement`, `payment`, `reverse`, `distribute`,
`document`, `download`, `report`, `notifications`, `settings`, `export`, `import`.
O tenant é determinado pelo perfil autenticado, nunca pelo corpo da requisição.

Documentos ficam no banco privado nesta versão. Migrar para bucket privado com
URLs temporárias quando o volume justificar, mantendo a mesma autorização.

## Testes

`node --test tests/money.test.mjs` executa testes monetários e CSV.
Para PostgreSQL local: instalar a dependência de desenvolvimento fixada no
package.json e executar `node tests/database.local.mjs`.
O teste usa PostgreSQL WASM e um substituto local de `auth.uid()`; ele **não**
valida integração hospedada de Supabase Auth. O relatório de entrega distingue
testes locais, testes hospedados e verificações visuais.

## Publicação

Hospedar o servidor Node atrás de proxy HTTPS, alterar o endereço de escuta conforme
o ambiente e fornecer as variáveis por configuração privada do host. Não ativar n8n
nem provedores financeiros antes de homologar credenciais, permissões e webhooks.
Aplicar SQL somente em um projeto novo e fazer backup antes de qualquer evolução.

Ponto de recuperação: commit `1fbaefda522dee1cd105b1e90c92aff1cd4282f1`.
As alterações estão na branch `codex/saas-cobranca`; a branch main foi preservada.
