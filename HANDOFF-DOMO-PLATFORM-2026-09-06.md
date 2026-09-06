# HANDOFF TÉCNICO — DOMO PLATFORM

**Atualizado em:** 2026-09-06  
**Repositório:** https://github.com/prmoraws/domo-platform.git  
**Branch:** `main`  
**Último commit confirmado:** `b243b0e` — `fix: evita fallback tecnico no atendimento publico`

## 0. Instruções para qualquer agente de IA

Este projeto está em produção. Antes de alterar qualquer coisa:

1. Leia este arquivo e a documentação em `docs/`.
2. Rode `git status --short`.
3. Não misture o agente administrativo com o atendimento público.
4. Não conecte o atendimento público ao banco.
5. Não exponha tokens, chaves, senhas, JIDs, conteúdo privado ou respostas brutas de provedores.
6. Antes de importar workflow n8n, faça backup do workflow ativo.
7. Preserve o workflow ID e o `webhookId` do workflow 20.
8. Para TypeScript: `npm test`, `npm run typecheck`, `npm run build`.
9. Para n8n: valide Code Nodes, publique, reinicie somente n8n e valide webhooks.
10. Falhas do Gemini no atendimento público devem ser silenciosas.
11. Não invente regra institucional; Salvador/Bahia é a fonte operacional específica.
12. Ao concluir mudanças arquiteturais ou operacionais, atualize este handoff.

## 1. Visão geral

DOMO Platform integra API TypeScript/Node.js, n8n, Evolution API, MariaDB réplica somente leitura, PostgreSQL, Redis, Gemini e Ollama.

Existem dois fluxos de WhatsApp totalmente separados.

### 1.1 Agente administrativo

- Evolution: `domo-assistente`
- n8n: `DOMO - 10 - Entrada WhatsApp`
- Workflow ID: `gseL5lW5viEgNEWQ`
- Webhook: `domo-whatsapp-inbound`
- Rota: `POST /internal/assistant/query`
- Finalidade: consultas administrativas seguras e somente leitura.
- Usa agente SQL controlado.
- Não é atendimento público.

### 1.2 Atendimento público — Momento do Presidiário

- Evolution: `domo-atendimento`
- WhatsApp: `(71) 99185-6704`
- n8n: `DOMO - 20 - Atendimento WhatsApp`
- Workflow ID: `VAhyWtgWl6kzU8gL`
- Webhook: `domo-atendimento-inbound`
- `webhookId`: `5a44db51-36ba-440d-878b-fb01678a921b`
- Rota: `POST /internal/customer-service/query`
- Finalidade: familiares, programa, áudio, dúvidas institucionais e encaminhamento pastoral.
- Não acessa banco.
- Não decide seleção de áudios.

## 2. Serviços de produção observados

- `domo-api`
- `domo-evolution`
- `domo-evolution-postgres`
- `domo-evolution-redis`
- `domo-mariadb-replica`
- `domo-n8n`
- `domo-ollama`
- `domo-postgres`

Versões observadas:

- Evolution `v2.3.7`
- n8n `2.33.4`
- PostgreSQL `17-alpine`
- Redis `7.4-alpine`
- MariaDB `10.11.18`
- Ollama `0.32.6`
- API DOMO `0.1.0`

Portas locais:

- API `127.0.0.1:3001`
- Evolution `127.0.0.1:8080`
- n8n `127.0.0.1:5678`
- MariaDB réplica `127.0.0.1:3307`
- Ollama `127.0.0.1:11434`

Fluxo público:

`WhatsApp -> Evolution -> n8n workflow 20 -> API customer-service -> n8n -> Evolution sendText -> WhatsApp`

Fluxo administrativo:

`WhatsApp autorizado -> Evolution -> n8n workflow 10 -> API assistant/query -> agente SQL seguro -> resposta`

## 3. Arquivos principais

Atendimento público:

- `apps/api/src/customer-service-agent.ts`
- `apps/api/src/customer-service-agent.test.ts`
- `apps/api/src/customer-service-knowledge.ts`
- `apps/api/src/customer-service-policy.ts`
- `apps/api/src/customer-service-policy.test.ts`
- `apps/api/src/customer-service-rules.ts`
- `apps/api/src/customer-service-rules.test.ts`
- `apps/api/src/customer-service-workflow.test.ts`
- `apps/api/src/server.ts`
- `infrastructure/n8n/workflows/20-atendimento-whatsapp.json`

Documentação:

- `docs/momento-presidiario.md`
- `docs/OPERACAO-MOMENTO-PRESIDIARIO.md`
- `docs/architecture/ATENDIMENTO-WHATSAPP.md`
- `docs/AGENTE-WHATSAPP-LOCAL.md`
- `docs/OBSERVABILIDADE-E-RECUPERACAO.md`
- `HANDOFF-DOMO-PLATFORM-2026-09-04.md`

Operação:

- `scripts/check-production-health.sh`
- `scripts/monitor-production-health.sh`

## 4. Base institucional do Momento do Presidiário

- Programa: `Momento do Presidiário`
- Organização: `UNP — Universal nos Presídios`
- Igreja: Igreja Universal do Reino de Deus
- Rádio: Rede Aleluia FM 95.9
- Transmissão: segunda a sexta, 21h às 22h
- Feriados: programa gravado
- WhatsApp público: `(71) 99185-6704`
- Participação ao vivo: `(71) 3432-9110`, durante o programa
- Atendimento espiritual/pastoral: `(71) 3432-9119`
- Catedral da Fé: domingos, 9h30, Av. Antônio Carlos Magalhães, 4197, Iguatemi, Salvador - BA

Apresentadores informados:

- Bispo Sérgio Simplício
- Pastor Moraes
- Missionária Lilian Moraes

## 5. Regras atuais para áudio

1. Áudio de até 20 segundos.
2. Enviar entre 21h e 22h.
3. Preferencialmente pelo Telegram.
4. Telegram é o canal oficial e preferencial.
5. O WhatsApp também recebe áudio quando o recebimento por aqui for anunciado.
6. Texto não é lido no ar.
7. Seleção de áudios é manual.
8. O assistente não interfere nos áudios.
9. Um áudio por dia por pessoa.
10. Ao receber áudio, não responder automaticamente.
11. Se perguntarem o que falar: mensagem de carinho e conforto.
12. Não prometer transmissão.
13. Não prometer data específica.

Resposta típica para “Por onde eu mando a mensagem?”:

> Para enviar uma mensagem ao seu familiar, envie um áudio de até 20 segundos. Preferencialmente, envie pelo Telegram, que é o canal oficial do Momento do Presidiário. Este WhatsApp também recebe os áudios quando o envio por aqui for anunciado. O áudio deve ser enviado entre 21h e 22h. Não é uma conversa direta com ele(a); o áudio poderá ser utilizado durante o programa. Mensagens de texto não são lidas no ar.

Resposta para Telegram:

> Sim. O Telegram continua sendo o canal oficial do Momento do Presidiário e é o canal preferencial para o envio dos áudios. Continuamos recebendo os áudios por lá normalmente. Este WhatsApp também recebe os áudios quando o envio por aqui for anunciado.

Não inventar link ou username do Telegram se não estiver cadastrado.

## 6. Horário do atendimento automático

Timezone: `America/Bahia`.

- Segunda a sexta fora de 21h–22h: atende.
- Segunda a sexta entre 21h–22h: suspenso para evitar conflito com o programa.
- Sábado: atende normalmente.
- Domingo: atende normalmente.
- Feriado: atende normalmente e, quando pertinente, informa que o programa é gravado.

Feriados locais importantes cobertos em código/testes incluem 24/06, 02/07 e 08/12, além dos nacionais e móveis implementados.

## 7. Regras sociais e `silent`

Exemplos:

- `Obrigada` -> `Por nada! Deus abençoe você e sua família. 🙏`
- `Amém` em conversa existente -> `silent: true`
- `Certo`, `Entendi`, `Tá bom`, `Combinado` em conversa existente -> silêncio
- `?`, `??`, `?!` isolados -> silêncio
- despedidas simples podem encerrar silenciosamente

Objetivo: evitar loops artificiais e chamadas desnecessárias ao Gemini.

## 8. Regras determinísticas

`customer-service-rules.ts` deve resolver sem Gemini, sempre que possível:

- saudação
- envio de áudio
- onde enviar
- Telegram
- horário de envio
- abreviações comuns
- telefone ao vivo
- telefone pastoral
- texto não lido no ar
- dúvidas jurídicas/processuais
- como ouvir
- horário do programa
- Catedral da Fé
- explicação contextual da UNP
- mensagens sociais
- feriados

Exemplos com regressão já criada:

- `Por onde eu mando a mensagem`
- `Onde mando o áudio?`
- `Q horas posso mandar`
- `Hj envia?`
- `Ainda posso mandar pelo Telegram?`
- `Obrigada`
- `Amém`
- `Certo`
- `?`

Princípio: perguntas operacionais frequentes não devem depender do Gemini.

## 9. Gemini

Gemini é usado para perguntas abertas não cobertas deterministicamente.

Variáveis relacionadas:

- `GEMINI_API_KEY`
- `GEMINI_API_URL`
- `GEMINI_MODEL`
- `GEMINI_PLANNER_MODEL`
- `GEMINI_RATE_LIMIT_COOLDOWN_SECONDS`

Modelo observado: `gemini-3.5-flash`.

Histórico enviado: até 10 mensagens anteriores.

Timeout do atendimento público: 20 segundos.

Falhas observadas:

- rejeição rápida em ~600–700 ms
- timeout em ~20 s

Política atual de falha pública:

```json
{
  "status": "temporarily_unavailable",
  "retryable": true,
  "assistant": {
    "answer": "",
    "provider": "fallback",
    "model": "customer-service-fallback",
    "durationMs": 0,
    "silent": true
  }
}
```

Ou seja: falha do Gemini não gera mensagem técnica ao usuário.

Nunca reintroduzir fallback textual público sem decisão explícita.

## 10. Workflow 20

Nome: `DOMO - 20 - Atendimento WhatsApp`

ID: `VAhyWtgWl6kzU8gL`

Nós:

1. `Webhook`
2. `Preparar atendimento`
3. `Responder?`
4. `Consultar atendimento`
5. `Registrar contexto`
6. `Preparar resposta`
7. `Responder WhatsApp`

Webhook path: `domo-atendimento-inbound`

`webhookId`: `5a44db51-36ba-440d-878b-fb01678a921b`

Rota consultada: `http://api:3001/internal/customer-service/query`

O workflow:

- rejeita instância errada
- ignora `fromMe`
- ignora grupos
- não responde mídia
- responde texto elegível
- suspende dias úteis 21h–22h
- mantém sessão/histórico
- deduplica `messageId`
- suporta `assistant.silent`
- mantém proteção de fallback
- envia via Evolution

## 11. Deduplicação e sessões

No `Preparar atendimento`:

- `state.customerSessions`
- `state.processedMessages`

Deduplicação:

- instância + `messageId`
- TTL de 15 minutos
- constante `DEDUP_TTL_MS`

Sessão:

- aproximadamente 30 minutos
- histórico limitado
- primeira interação depende da sessão

## 12. Contrato `silent`

Resposta determinística silenciosa:

```json
{
  "status": "ok",
  "assistant": {
    "answer": "",
    "provider": "deterministic",
    "model": "deterministic-rule",
    "durationMs": 0,
    "silent": true
  }
}
```

`Registrar contexto`:

- lê `assistant.silent`
- atualiza contexto quando necessário
- não inclui resposta vazia como mensagem do assistente
- retorna `[]` para encerrar fluxo
- não chega ao `Responder WhatsApp`

## 13. Cooldown de fallback

Estruturas existentes:

- `state.customerFallbacks`
- `FALLBACK_COOLDOWN_MS`
- cooldown de 10 minutos

Criado para impedir repetição do fallback técnico. Como hoje o fallback público é silencioso, funciona como proteção adicional.

## 14. Incidente: `Identifier 'state' has already been declared`

Em 2026-09-05, após adicionar cooldown, o nó `Registrar contexto` ficou com duas declarações:

`const state = ...`

Sintoma:

`SyntaxError: Identifier 'state' has already been declared`

Consequência:

- Evolution recebia
- n8n iniciava execução
- workflow falhava
- resposta não chegava

Correção:

- `Registrar contexto` reescrito
- uma única declaração de `state`
- workflow republicado
- n8n reiniciado
- erro desapareceu

Foi criado teste de sintaxe dos Code Nodes.

Atenção: Code Nodes do n8n aceitam `return`; portanto o teste deve envolver o código em função assíncrona:

```js
new vm.Script(`(async () => {
${code}
})()`)
```

Não usar `new vm.Script(code)` puro, pois gera falso `Illegal return statement`.

## 15. Testes

Estado confirmado: **101 testes aprovados**.

- tests `101`
- pass `101`
- fail `0`
- typecheck `0`
- build `0`

Comandos:

```bash
cd ~/domo-platform/apps/api
npm test
npm run typecheck
npm run build
```

Antes de commit:

```bash
cd ~/domo-platform
git diff --check
git status --short
```

Cobertura inclui atendimento, política de horário, mídia, grupos, `fromMe`, Telegram, abreviações, `silent`, workflow, webhook, dedup, cooldown, sintaxe dos Code Nodes, agente SQL e segurança SQL.

## 16. Agente administrativo e segurança SQL

O agente administrativo é separado do atendimento público.

Proteções já testadas:

- apenas SELECT autorizado
- bloqueio de `SELECT *`
- bloqueio de colunas protegidas
- bloqueio de DELETE
- bloqueio de UPDATE
- bloqueio de UNION
- bloqueio de múltiplas instruções
- bloqueio de comentários
- bloqueio de `SLEEP`
- JOIN apenas autorizado
- LIMIT controlado
- resolução por ID
- catálogo de banco
- correção controlada de consulta

A réplica MariaDB protege o banco principal.

Nunca conectar workflow 20 ao agente administrativo.

## 17. Evolution

Instâncias:

`domo-assistente`
- webhook `http://n8n:5678/webhook/domo-whatsapp-inbound`

`domo-atendimento`
- webhook `http://n8n:5678/webhook/domo-atendimento-inbound`

Evento: `MESSAGES_UPSERT`

Status esperado: `open`.

`open` não substitui teste ponta a ponta.

Diagnóstico Evolution:

```bash
docker compose logs -f evolution
```

Procurar:

- `domo-atendimento`
- `WebhookController`
- `messages.upsert`
- `Sending message`
- erros 401/conflict/disconnect

Não documentar token de instância.

## 18. Publicação n8n segura

A instalação usa modo regular. `--activeState=fromJson` não funciona para ativação nessa topologia.

Procedimento testado:

1. exportar workflow ativo
2. preservar metadados
3. importar
4. publicar
5. reiniciar n8n
6. validar `/healthz`
7. validar `webhook_entity`
8. testar webhook HTTP 200
9. exportar novamente para confirmar

Backup:

```bash
docker compose exec -T n8n   n8n export:workflow   --id=VAhyWtgWl6kzU8gL   --output=/tmp/domo-20-backup.json
```

Import:

```bash
docker compose exec -T n8n   n8n import:workflow   --input=/tmp/workflow.json
```

Publish:

```bash
docker compose exec -T n8n   n8n publish:workflow   --id=VAhyWtgWl6kzU8gL
```

Restart:

```bash
docker compose restart n8n
```

Health:

```bash
curl -fsS http://127.0.0.1:5678/healthz
```

## 19. Armadilha do `webhookId`

O JSON versionado já perdeu o `webhookId` em incidente anterior.

Consequência: n8n registrou path prefixado por workflow ID e `/webhook/domo-atendimento-inbound` retornou 404.

Preservar:

`5a44db51-36ba-440d-878b-fb01678a921b`

Validar no PostgreSQL:

```sql
SELECT "workflowId", "webhookPath", method
FROM webhook_entity
WHERE "workflowId" = 'VAhyWtgWl6kzU8gL';
```

Esperado:

`VAhyWtgWl6kzU8gL | domo-atendimento-inbound | POST`

## 20. PostgreSQL/n8n e shell

Se `$POSTGRES_USER` não estiver exportado, `psql` tenta usuário `root` e retorna:

`FATAL: role "root" does not exist`

Ler valores do `.env` sem imprimir senha.

## 21. Health check

Scripts:

- `scripts/check-production-health.sh`
- `scripts/monitor-production-health.sh`

Valida:

- API `/health`
- n8n `/healthz`
- instâncias Evolution
- webhooks Evolution
- registros n8n

Monitor:

- silencioso quando saudável
- loga falhas
- não reinicia serviços
- `var/log/` ignorado no Git

Princípio: monitorar não significa reiniciar automaticamente.

## 22. Diagnóstico ponta a ponta

Quando WhatsApp não responde:

1. Evolution recebeu?
2. Workflow 20 executou?
3. API recebeu?
4. n8n apresentou erro?
5. Evolution enviou?

Evolution:

```bash
docker compose logs --since=10m evolution
```

n8n:

```bash
docker compose logs --since=10m n8n
```

API:

```bash
docker compose logs --since=10m api
```

Execuções n8n: consultar `execution_entity` por workflow ID.

Não reiniciar tudo antes de descobrir em qual elo a cadeia parou.

## 23. Aviso Python Task Runner

Foi observado aviso de Python 3 ausente no n8n.

Não foi causa dos incidentes do workflow 20, pois os Code Nodes são JavaScript.

Não instalar Python no container apenas para remover o aviso.

## 24. Endpoint público interno

`POST /internal/customer-service/query`

Autenticação: Bearer token interno.

Entrada:

```json
{
  "message": "Por onde eu mando a mensagem",
  "firstInteraction": false,
  "isHoliday": false,
  "localDate": "2026-09-05",
  "localTime": "16:00",
  "history": []
}
```

## 25. Saudação

Primeira interação:

`Bom dia/Boa tarde/Boa noite!`

seguido de:

`Programa Momento do Presidiário. Em que posso ajudar?`

Não repetir na mesma sessão.

## 26. Questões jurídicas/processuais

A UNP presta assistência espiritual e não possui acesso a:

- processo
- audiência
- situação jurídica
- informações administrativas do sistema prisional

Orientar advogado ou assistente social da unidade.

Nunca usar o agente administrativo para responder a familiares.

## 27. Explicação contextual da UNP

Para familiares, evitar misturar agentes/funcionários do sistema prisional sem necessidade.

Formulação adequada:

`A UNP — Universal nos Presídios — é um trabalho da Igreja Universal do Reino de Deus voltado à assistência espiritual de pessoas privadas de liberdade e de seus familiares. Por meio desse trabalho, buscamos levar fé, esperança, apoio e uma palavra de conforto para quem enfrenta esse momento.`

## 28. Mídia

- áudio: sem resposta automática
- imagem: sem resposta
- vídeo: sem resposta
- documento: sem resposta
- figurinha: sem resposta
- `fromMe`: sem resposta
- grupo: sem resposta

## 29. Deploy API

```bash
docker compose up -d --build api
```

Depois validar:

```bash
curl -fsS http://127.0.0.1:3001/health
```

## 30. Git

Repositório:

`https://github.com/prmoraws/domo-platform.git`

Branch: `main`

Commits importantes:

- `b243b0e` fallback público silencioso
- `bd5ae68` envio/Telegram e fallback repetido
- `a3380eb` atendimento social/Telegram
- `c9336c8` monitor periódico
- `3703967` health check
- `0432f9b` atendimento Momento do Presidiário
- `f257df6` observabilidade/recuperação
- `f8b56a0` agente Gemini/sessões
- `5411202` Gemini 3.5 SQL planner
- `7064bdc` agente local de banco

Nunca commit:

- `.env`
- tokens
- senhas
- credenciais
- logs privados
- backups com segredos
- dados pessoais

## 31. Checklist

Antes:
- `git status --short`
- identificar fluxo correto
- confirmar regra institucional se faltar
- backup n8n se necessário

Durante:
- teste de regressão
- preservar isolamento público/admin
- preservar IDs/webhookId
- validar Code Nodes
- não vazar secrets

Depois:
- `npm test`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- deploy controlado
- health
- webhook
- teste real
- logs
- commit
- push
- atualizar handoff

## 32. Como criar nova regra

1. partir de exemplo real
2. adicionar teste
3. implementar em `customer-service-rules.ts`
4. atualizar `customer-service-knowledge.ts` se institucional
5. rodar testes
6. testar função local
7. deploy API
8. teste real
9. commit

Evitar regex amplas demais.

## 33. Como alterar workflow 20

1. exportar ativo
2. confirmar ID
3. confirmar `webhookId`
4. alterar JSON versionado
5. validar estrutura
6. validar Code Nodes
7. preservar metadados
8. importar
9. publicar
10. reiniciar n8n
11. health
12. validar `webhook_entity`
13. HTTP 200
14. exportar e conferir
15. teste ponta a ponta

## 34. Estado conhecido ao fechar este handoff

Confirmado:

- API saudável
- n8n saudável
- Evolution operacional
- workflows 10 e 20 ativos
- webhooks corretos
- workflow 20 com `assistant?.silent`
- `processedMessages`
- `DEDUP_TTL_MS`
- `customerFallbacks`
- `FALLBACK_COOLDOWN_MS`
- `Registrar contexto` corrigido
- fallback Gemini público silencioso
- 101 testes aprovados
- typecheck aprovado
- build aprovado

## 35. Melhorias futuras recomendadas

1. classificar erros Gemini de forma sanitizada
2. métricas de deterministic/Gemini/silent
3. teste ponta a ponta automatizado
4. ampliar normalização de linguagem de WhatsApp com casos reais
5. atualizar base institucional
6. revisar feriados
7. observabilidade sem PII
8. task runner externo n8n apenas se necessário

## 36. Fontes institucionais informadas

- https://universalnospresidios.com/nossa-historia/
- https://www.universal.org/a-universal/
- https://www.universal.org/a-universal/nossa-historia/
- https://www.universal.org/agenda/
- https://www.universal.org/politica-de-privacidade/
- https://www.universal.org/localizar/
- https://redealeluia.com.br/
- https://universalnospresidios.com/momento-do-presidiario-2/

Regra específica Salvador/Bahia prevalece sobre informação genérica.

## 37. Segredos proibidos em documentação

Nunca registrar:

- `EVOLUTION_API_KEY`
- tokens Evolution
- `API_INTERNAL_TOKEN`
- `GEMINI_API_KEY`
- senhas PostgreSQL/MariaDB
- credenciais n8n
- JIDs pessoais desnecessários
- conteúdo privado
- material criptográfico de logs

## 38. Prompt de continuidade para outro agente

> Leia integralmente `HANDOFF-DOMO-PLATFORM-2026-09-06.md`, `docs/momento-presidiario.md`, `docs/OPERACAO-MOMENTO-PRESIDIARIO.md` e `docs/architecture/ATENDIMENTO-WHATSAPP.md`. Este sistema está em produção. Antes de alterar arquivos, rode `git status --short`, identifique se a tarefa pertence ao agente administrativo ou ao atendimento público e preserve o isolamento. Para workflow 20, preserve ID `VAhyWtgWl6kzU8gL`, webhook `domo-atendimento-inbound` e `webhookId` `5a44db51-36ba-440d-878b-fb01678a921b`. Nunca conecte o atendimento público ao banco administrativo. Toda alteração deve ter teste de regressão, `npm test`, `npm run typecheck`, `npm run build`, `git diff --check`, deploy controlado e validação ponta a ponta.

## 39. Resumo executivo

- dois WhatsApps distintos
- workflow 10 administrativo
- workflow 20 público
- atendimento público sem banco
- Telegram oficial/preferencial para áudio
- WhatsApp recebe quando anunciado
- áudio até 20 s
- envio 21h–22h
- não responder mídia
- dias úteis 21h–22h: atendimento suspenso
- sábado/domingo/feriado: atendimento ativo
- regras frequentes determinísticas
- Gemini para perguntas abertas
- falha Gemini = silêncio
- preserve IDs e `webhookId`
- Code Nodes devem ter sintaxe validada
- 101 testes verdes
- produção exige backup e cautela
