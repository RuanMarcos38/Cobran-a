# Resultados executados em 09/10/2026

## Valores monetários e CSV — 6 testes, 6 aprovados

- Conversão exata em centavos e separador brasileiro.
- Rejeição de precisão excessiva, números negativos e não finitos.
- Preservação de centavos nas parcelas, incluindo 120 divisões.
- Rejeição de parcelas inferiores a um centavo.
- Exportação CSV com escape e proteção contra fórmulas.
- Leitura CSV com delimitadores e quebras de linha em campos.

## PostgreSQL local — aprovado

Scripts originais e extensão da aplicação executados em PostgreSQL WASM PGlite 0.5.8.
CRUD de cliente/devedor, criação de processo, consulta com filtro, histórico,
acordo com soma exata das parcelas, pagamento parcial, alocação por parcela,
rejeição de referência duplicada e de pagamento excessivo, estorno e reversão
da alocação, importação transacional e rollback integral de arquivo inválido,
validação de assinatura de documento e auditoria.

Verificações de autorização: cobrador sem acesso a cadastro de credor e baixa
financeira; outro tenant sem acesso a processo ou credor; portal credor sem
permissão de mudar status; escrita direta em tabela bloqueada.

## Navegador local — aprovado

Chrome headless com Playwright 1.64.0: login/logout, cadastro de cliente/devedor,
processo, atendimento, pagamento, atualização de saldo, F5 e painel gerencial.
Verificada ausência de erro JavaScript e de transbordamento horizontal da página.

Resoluções executadas: 1920×1080, 1366×768, 1024×768, 768×1024 e 390×844.

As requisições de negócio chegaram à função SQL real no PostgreSQL local.
Supabase Auth e o transporte remoto foram substituídos por fixtures somente no
teste. As capturas contêm dados sintéticos de teste, nunca dados de produção.

## PostgreSQL hospedado — aprovado

No projeto Supabase indicado pelo usuário, foram executados cadastro de credor e
devedor, criação de processo, acordo, soma de parcelas, pagamento parcial,
rejeição de duplicidade e verificação dos privilégios. Todos passaram.
O teste usou uma transação desfeita ao final; nenhuma receita de teste permaneceu.
Isso valida a API no banco remoto, mas não substitui o teste de login com Supabase Auth.
Após políticas explícitas de bloqueio de acesso direto, o verificador de segurança
do Supabase retornou lista de avisos vazia.

## Não executado

Testes de login real com Supabase Auth, provedores externos, deploy, performance de grandes
carteiras, recuperação de backup, revisão operacional/jurídica e homologação
completa de todos os módulos do prompt. O usuário precisa criar sua senha e
confirmar o e-mail administrativo na tela de cadastro.
