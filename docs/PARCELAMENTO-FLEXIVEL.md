# Entrada e parcelas com datas independentes

O campo Data da entrada é mostrado quando há entrada. A primeira parcela deve ter data posterior à entrada. A periodicidade determina as parcelas seguintes a partir da primeira parcela escolhida. Há opções semanal (7 dias), quinzenal (15 dias), mensal por calendário e a cada 20 dias, além das opções já existentes. Datas individuais continuam editáveis.

Exemplo: entrada em 30/10/2028 e primeira parcela semanal em 06/11/2028; seguintes em 13/11 e 20/11. Para 20 dias: 19/11, 09/12, 29/12. A data inicial é livre e não muda automaticamente ao trocar a periodicidade; revise-a antes de formalizar.

Somente as datas da entrada foram desvinculadas. Totais, juros, multas, honorários, descontos, alçadas, arredondamento, isolamento e aceite permanecem no motor existente. PDF, Excel e texto usam o cronograma simulado ou efetivamente gravado. O demonstrativo recupera os vencimentos das parcelas gravadas, incluindo a entrada.

Migration: 20261029125502_flexible_entry_dates.sql. Atualiza apenas payment_dates e joint_negotiation; não modifica acordos anteriores. Para compatibilidade com clientes antigos, a ausência do novo atributo down_payment_due_date preserva o comportamento anterior. O formulário atualizado sempre envia a data independente e a valida no cliente e no servidor.

Reversão: database/rollback/042-flexible-entry-dates.sql restaura as duas funções anteriores sem apagar dados. Reverter também os dois módulos web para o commit anterior. Para produção, registrar na tabela de migrations e capturar as definições anteriores na mesma transação antes de substituir.

Validação: testes de 109 casos; calendário real em PostgreSQL local com formalização, recuperação do acordo, datas individuais, 20 dias, valores e permissões; interface desktop e celular com bloqueio de entrada na mesma data, cancelamento e recarga. Nenhum acordo fictício deve ser formalizado em produção.
