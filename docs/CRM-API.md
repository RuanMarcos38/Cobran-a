# CRM comercial, comissões e integração de credores

O sistema existente mantém sua carteira, financeiro, perfis e contratos. As migrações 011 e 012 adicionam estruturas privadas e ampliam os perfis com Comercial e Gestor comercial. A interface passa a usar menu lateral conforme a referência fornecida.

## Acesso por setor

- Administrador: configura usuários, regras, equipe e integrações da própria empresa; acessa todos os setores.
- Gestor comercial: gerencia oportunidades e agendas do comercial da própria empresa.
- Comercial: acessa suas oportunidades, atendimento, agenda e comissões comerciais.
- Gestor e Negociador de cobrança: sem acesso ao CRM comercial. A agenda operacional da cobrança está em Processo → Agenda da cobrança.
- Financeiro e Cliente: mantêm seus acessos anteriores; sem CRM comercial.

As restrições são verificadas no banco e na API. Esconder menus não é o mecanismo de segurança. As tabelas novas são privadas, com acesso direto bloqueado. A conexão de um credor nunca concede leitura da carteira.

## Funil e atendimento

Comercial → Prospecção, Funil / Kanban ou Atendimento. Crie a oportunidade, informe contato, responsável, valor e contrato. Mude a etapa pela seleção do cartão. A atualização verifica a versão do registro para impedir sobrescrita silenciosa. Atender registra canal, assunto e conteúdo no histórico. O registro não envia mensagens externas de WhatsApp, e-mail ou telefonia. Agendamentos são do setor comercial e podem ser vinculados à oportunidade.

## Comissões

Cadastro → Regras de comissão, exclusivo do administrador. Escolha usuário, setor, taxa, base e contrato opcional. Regras de contrato têm prioridade sobre a regra geral do mesmo usuário. Uma regra geral de comercial sobre recebimentos aplica-se aos recebimentos da empresa; use contrato específico quando a comissão pertencer somente a um contrato. Para negociador de cobrança, a regra aplica-se ao responsável do processo no momento do recebimento.

Comercial: base venda ganha ou valor efetivamente recebido. Cobrança: base valor efetivamente recebido. A comissão sobre recebimento usa o valor bruto registrado, incluindo os encargos recebidos. Percentuais não são presumidos: cadastre a regra aprovada pelo contrato.

O cálculo gera lançamentos em centavos e registra a taxa utilizada. Estorno do recebimento reverte a comissão associada. Tirar uma oportunidade de Ganho reverte a comissão da venda; retornar a Ganho não duplica o mesmo evento. Alterações de regra não recalculam recebimentos antigos. O sistema calcula a comissão; não transfere dinheiro nem paga automaticamente colaboradores.

## Distribuição automática

Cadastro → Distribuição automática. Selecione negociadores ativos e ative o rodízio. A regra afeta somente processos novos, incluindo borderôs recebidos pela API; não muda a carteira existente. A seleção é serializada no banco. Se a equipe ficar sem negociadores ativos, a inclusão de novos processos é rejeitada até corrigir a configuração.

## API aberta para integração, com autenticação

Documentação OpenAPI pública: https://financeiro.rrestrategiaperformance.com.br/api/openapi.json

Operações da plataforma: POST /api/v1/{action}, com Authorization: Bearer e a sessão Supabase do usuário autorizado. O corpo é o payload da operação; a resposta contém data. Mesmas permissões da ferramenta, sem leitura pública de dados. A autenticação é validada pelo Supabase, seguindo [o modelo de segurança da Data API](https://supabase.com/docs/guides/api/securing-your-api).

Borderôs: POST /api/v1/borderos, com Content-Type: application/json e X-Integration-Key. Gere a chave em Cadastro → Integrações / API, escolhendo o credor. A chave aparece uma vez; o banco guarda somente seu hash. Gerar novamente para o mesmo credor invalida a anterior. Desativar a conexão interrompe envios.

Exemplo de corpo:

```json
{
  "external_id": "BORDERÔ-2026-001",
  "contract_ref": "CONTRATO-001",
  "items": [
    {
      "external_ref": "TITULO-001",
      "original_amount": "1000.00",
      "due_date": "2026-10-01",
      "debtor_name": "Nome do devedor",
      "debtor_document": "Documento do devedor"
    }
  ]
}
```

Limites: 1 a 100 títulos por lote, até 1 MB. external_id identifica o lote na conexão; repetições devolvem o resultado anterior. external_ref identifica o título no credor; título já existente não é recriado. Lote inválido é rejeitado integralmente. Juros e multa vêm da regra cadastrada no credor; contrato obrigatório quando há encargos. É necessário ter um negociador ativo.

O endpoint está pronto para o sistema do credor enviar novos borderôs automaticamente. É necessário configurar esse envio no sistema de origem ou criar o adaptador correspondente à API do fornecedor. Ainda não foi informado qual fornecedor deve ser conectado. Não existe uma conexão universal automática com ERPs desconhecidos. Não coloque chaves em URL, frontend público ou repositório.

## Verificação

Testes de banco validam isolamento de empresas, isolamento entre comerciais, bloqueio entre setores, concorrência de versão, comissões e reversões, rodízio, validação e repetição de lotes. Testes de interface validam CRM, atendimento, agenda, regras, distribuição, criação/revogação de chaves e navegação responsiva. A autenticação dos testes locais usa fixture, e esses testes não representam envio a um credor real nem pagamento real.

Pendências externas: selecionar o sistema do credor e configurar o envio de origem; informar taxas e equipe reais; homologar confirmação de e-mail de usuários externos e restauração de backup. Essas dependências não foram presumidas como concluídas.
