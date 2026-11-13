# Importação de cheques e fichas cadastrais — implantação segura

Status: módulo `document-intake.mjs` criado apenas para validar uploads e converter **texto já reconhecido** em rascunho. **Não há OCR integrado ao backend nem importação automática de títulos/cadastros publicada.**

## Documentos de referência recebidos em 10/11/2026

- Frente de três cheques do Banco do Brasil no valor aparente de R$ 7.970,00 cada, com datas aparentes 27/03, 27/04 e 27/05/2026; total a conferir: R$ 23.910,00.
- Versos com carimbos de devolução, motivos visíveis 11 e 12. As datas dos carimbos não são a mesma coisa que a data de vencimento do débito.
- Ficha cadastral com dados pessoais e empresariais. É obrigatório confirmar a correspondência de CPF/CNPJ e evitar inserção duplicada.

## Fluxo a implementar sem alteração dos processos existentes

1. Administrador, gestor autorizado ou negociador com permissão específica seleciona credor e tipo (cheque ou ficha de devedor).
2. Receber arquivo JPEG/PNG/PDF; validar autenticação, carteira, tamanho, tipo pelo conteúdo, páginas, dimensões e usuário/tenant no servidor.
3. Armazenar temporariamente com identificador aleatório em área privada; AV/CDR onde aplicável; processar de forma isolada, com limite de CPU, memória e tempo.
4. Extrair texto com mecanismo OCR realmente implantado e autorizado, com suporte a português, e verificar frente e verso do cheque. PDF com texto usa extração textual; PDF digitalizado usa OCR.
5. Mostrar foto/PDF ao lado dos campos candidatos editáveis, indicando incerteza. Não atribuir certeza artificial a datas, valores, CPF/CNPJ, motivo de devolução, beneficiário ou emitente.
6. Apresentar diferença entre emissão, data do cheque, apresentação, devolução e vencimento adotado para cobrança. Registrar justificativa.
7. Verificar duplicidades com chaves do cheque (banco/agência/conta/número e emitente) ou CPF/CNPJ do devedor, consultando o tenant e credor correspondentes; checagem repetida atomicamente no backend.
8. Salvar título e cadastro apenas com confirmação explícita, dentro de transação, com auditoria e vínculo ao documento original privado. Não disparar cobrança na importação.
9. Exibir títulos recém-criados e impedimentos; em caso de erro, reverter a transação, sem títulos parciais.
10. Testar regressão no sistema em homologação e validar deploy/rollback antes de publicar.

## Segurança — OWASP Top 10 2025 / ASVS 5.0 / File Upload Cheat Sheet

- Autorização de objeto em **cada endpoint**, inclusive de importação, OCR, prévia, download, criação e exclusão; evitar IDOR e vazamento entre credores e tenants.
- Validação completa do formato real dos arquivos; allowlist de tipos; limites de tamanho/páginas/resolução; nomes aleatórios; bucket privado; acesso temporário e expiração; proteção contra CSRF e rate limiting.
- Isolar OCR de fontes não confiáveis; impedir execução de conteúdo ativo; não usar texto OCR como prompt/instrução confiável e não gravá-lo em logs públicos.
- Criptografia em trânsito e repouso, controle de chaves e segredos, logs auditáveis sem dados sensíveis, proteção contra injeção/XSS e alertas de comportamento anormal.
- SAST, análise de dependências, testes de autorização por tenant, DAST com escopo autorizado, backup/restauração e monitoramento.
- LGPD: minimizar coleta e retenção de documentos bancários, restringir visualização por perfil, definir base legal, informar uso e aplicar política de retenção/descarte.

Referências:
https://top10.owasp.org/2025/pt-BR/
https://asvs.owasp.org/
https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

## Critérios de aceite

A funcionalidade só poderá ser marcada como concluída quando: (a) fotos e PDF digitalizados forem reconhecidos por OCR real em homologação; (b) a prévia permitir ajustes; (c) os três cheques retornarem dados com acurácia revisada pelo operador; (d) a ficha do devedor não duplicar CPF/CNPJ; (e) a importação for transacional e auditada; (f) os testes OWASP e de regressão forem executados; e (g) a produção for validada após publicar. **Sem essas etapas, não afirmar que o módulo está pronto ou que o sistema é inviolável.**
