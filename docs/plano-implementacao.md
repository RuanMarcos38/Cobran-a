# Diagnóstico e plano

Base remota preservada: `1fbaefda522dee1cd105b1e90c92aff1cd4282f1`.
Branch: `codex/saas-cobranca`.

O repositório possui README, gitignore e um ZIP com workflow n8n, SQL Supabase,
modelos de mensagem e documentação. Não possui frontend, backend web, dependências,
rotas ou autenticação implementada. Os arquivos do ZIP foram extraídos sem modificações.

1. Preservar pacote original e usar projeto Supabase separado.
2. Implementar aplicação web modular sem etapa de compilação e servidor Node.
3. Manter organização visual da referência com identidade Cobran-a.
4. Usar Supabase Auth e PostgreSQL; nunca enviar service_role ao navegador.
5. API transacional via RPC com autorização de tenant e perfil no banco.
6. Reutilizar entidades cobranca_* existentes do pacote e ampliar os módulos.
7. Validar cálculos, isolamento, fluxos e interface antes de habilitar operação.
8. Publicar em branch revisável e registrar limitações e resultados reais.

Integrações WhatsApp, pagamento e IA só podem ser ativadas depois de configuradas e
testadas. O workflow original permanece inativo e não é habilitado automaticamente.
