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

- Organização e criação do projeto Supabase separado indicadas pelo usuário.
- Publicação e testes reais de Supabase Auth e sessão hospedada.
- Provisionamento de usuários e portal credor com navegação dedicada.
- Todos os campos extensivos de cadastro, múltiplos contatos/endereços/títulos.
- Juros/multa auditáveis: taxas são cadastradas, mas não aplicadas automaticamente.
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
