# Status verificável

O projeto é uma primeira implementação web integrada a uma API PostgreSQL/Supabase.
Não é apresentado como SaaS completo ou homologado para produção.

## Implementado em código

- Interface com a organização da imagem: cabeçalho, cinco módulos, ribbon,
  ações, abas F5–F9, filtros e tabela compacta; adaptação para telas menores.
- Supabase Auth por e-mail/senha, sessão e logout.
- Consulta paginada de processos com filtros executados no banco.
- Clientes, devedores, cadastros auxiliares, despesas, prospecção e agenda.
- Cadastro de processos, atribuição manual e distribuição em lote.
- Histórico, promessa de pagamento, mudança de situação com motivo.
- Acordo com alçada de desconto e divisão exata de parcelas.
- Recebimento manual com referência única, saldo parcial, honorários e estorno via API.
- Documentos em armazenamento privado no PostgreSQL, acesso autenticado,
  limite de 5 MB e validação de assinatura PDF/PNG/JPEG.
- Indicadores consultados do banco, exportação CSV e impressão pelo navegador.
- Importação transacional de até 500 clientes/devedores por CSV.
- Perfis e tenant verificados no banco; credor apenas consulta sua carteira;
  cobrador consulta apenas processos atribuídos. Tabelas sem privilégios diretos
  de escrita para o navegador. Função privilegiada em schema privado.
- Auditoria dos movimentos e manutenção do valor original.

## Ainda necessário para cumprir todo o prompt

- Frontend publicado; falta teste completo de Supabase Auth após o usuário criar
  sua senha e confirmar o e-mail. O banco separado indicado já está conectado;
  esquema e regras financeiras foram testados no PostgreSQL hospedado.
- Navegação dedicada para o portal credor. A autorização de usuários por empresa e perfil já foi implementada.
- Todos os campos extensivos de cadastro, múltiplos contatos/endereços/títulos.
- Regras além de juros simples mensais (30 dias) ou diários: capitalização e índices de correção não estão implementados.
- Aprovação de propostas, aceite documental e renegociações de acordo ativo.
- Tratamento programado de parcelas vencidas e quebra de acordos.
- Comissões, repasses efetivamente executados, conciliação e categorias completas.
- Relatórios especializados completos e gráficos; alguns relatórios usam a consulta
  geral de processos. Não anunciar como concluídos individualmente.
- Exportação XLSX/PDF gerado no servidor e importação XLSX.
- Filtros salvos, gestão de planos, permissões granulares e metas por carteira.
- Distribuição automática, filas, rotinas programadas e reprocessamento de eventos.
- WhatsApp Business oficial, PIX/boleto/cartão, webhooks autenticados, e-mail e IA.
- Testes completos do frontend, backend e integração hospedada nas cinco resoluções.
- Política operacional de backup, retenção, anonimização e homologação LGPD.

O workflow n8n original foi preservado e não ativado. Ele necessita avaliação e
configuração antes de qualquer envio externo.

## Auditoria de 10/10/2026

Implementados: regras contratuais por cliente e processo, memória de juros/multa, recebimento com cálculo registrado, bloqueio de alteração de contrato após movimentos, usuários por convite com e-mail confirmado, cadastro de empresa com tenant independente, desativação de acessos e proteção da sessão contra respostas de sessão anterior.

Passaram: sete testes unitários (incluindo troca de sessão), suite PostgreSQL com migrações 001 a 008, todos os filtros com correspondência e exclusão, isolamento em consulta/edição/documentos/recebimentos, onboarding e permissões; suite de telas com cadastros, módulos, relatórios, exportação, acordo, documento/download, estorno, encargos e cinco resoluções. O teste local substitui o Supabase Auth por uma fixture. No banco hospedado, o teste de encargos/recebimento/estorno passou em transação revertida.

Ainda não homologado para produção: login e fluxo de telas com conta real; certificado do domínio financeiro; recomendação do Supabase para proteção contra senhas vazadas; rotina de backup e restauração. A auditoria dos recursos disponíveis não completa automaticamente todas as integrações do prompt original.

Autenticação: mínimo de 12 caracteres, troca segura com senha atual e retorno para o endereço público seguro configurados. SMTP próprio não configurado; aguarda definição do provedor existente. Proteção contra senhas vazadas exige Pro e não foi contratada.
