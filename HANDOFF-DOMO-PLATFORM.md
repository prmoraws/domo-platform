# HANDOFF TÉCNICO — DOMO PLATFORM

**Documento canônico. Atualizado em 2026-09-06.**

Repositório: `prmoraws/domo-platform`  
Branch de produção: `main`

> Este é o único handoff ativo do projeto. Handoffs datados antigos foram consolidados aqui e devem ser consultados somente pelo histórico do Git.

## 0. Regras para qualquer agente de IA

Antes de alterar produção:

1. Leia este arquivo e a documentação em `docs/`.
2. Confira `git status --short` e os commits recentes.
3. Não misture o agente administrativo com o atendimento público.
4. Atendimento público nunca acessa MariaDB/MySQL nem o agente SQL.
5. Não exponha tokens, chaves, senhas, JIDs ou respostas brutas de provedores.
6. Faça backup de workflow n8n ativo antes de importar/substituir.
7. Preserve IDs/webhookIds dos workflows existentes.
8. Rode `npm test`, `npm run typecheck`, `npm run build` em `apps/api`.
9. Rode `git diff --check` antes de commit.
10. Falha do Gemini no atendimento público deve permanecer silenciosa.
11. Regras operacionais de Salvador/Bahia têm prioridade sobre informação genérica.
12. Atualize este handoff após mudanças arquiteturais ou operacionais.

## 1. Arquitetura

A DOMO Platform usa Node.js/TypeScript, n8n, Evolution API, PostgreSQL, Redis, MariaDB réplica somente leitura, Gemini e Ollama.

Há três canais/fluxos logicamente separados:

### 1.1 Agente administrativo — WhatsApp

- Evolution: `domo-assistente`
- n8n: `DOMO - 10 - Entrada WhatsApp`
- workflow ID: `gseL5lW5viEgNEWQ`
- webhook: `domo-whatsapp-inbound`
- API: `POST /internal/assistant/query`
- pode consultar a réplica somente leitura por meio do agente SQL seguro.

### 1.2 Atendimento público — WhatsApp

- Evolution: `domo-atendimento`
- WhatsApp: `(71) 99185-6704`
- n8n: `DOMO - 20 - Atendimento WhatsApp`
- workflow ID: `VAhyWtgWl6kzU8gL`
- webhook path: `domo-atendimento-inbound`
- webhookId: `5a44db51-36ba-440d-878b-fb01678a921b`
- API: `POST /internal/customer-service/query`
- não acessa banco.

### 1.3 Atendimento público — Telegram

- n8n: `DOMO - 30 - Atendimento Telegram`
- arquivo: `infrastructure/n8n/workflows/30-atendimento-telegram.json`
- API: a mesma `POST /internal/customer-service/query`
- usa a mesma base institucional e as mesmas regras do WhatsApp;
- sessões: `telegram:<chat_id>`;
- deduplicação: `telegram:<chat_id>:<message_id>`;
- texto privado elegível recebe atendimento;
- mídia/áudio não recebe resposta automática;
- grupos e mensagens de bots são ignorados;
- `silent` e fallback silencioso são preservados;
- o workflow fica desativado no Git até a credencial Telegram ser associada no n8n.

Documentação operacional: `docs/architecture/ATENDIMENTO-TELEGRAM.md`.

## 2. Fluxos

```text
WhatsApp administrativo
 -> Evolution domo-assistente
 -> workflow 10
 -> /internal/assistant/query
 -> agente SQL seguro / réplica

WhatsApp público
 -> Evolution domo-atendimento
 -> workflow 20
 -> /internal/customer-service/query
 -> regras determinísticas ou Gemini
 -> Evolution
 -> WhatsApp

Telegram público
 -> Telegram Bot
 -> workflow 30
 -> /internal/customer-service/query
 -> regras determinísticas ou Gemini
 -> Telegram Bot
```

Não criar um segundo “cérebro” para Telegram. Conhecimento e política devem continuar centralizados na API.

## 3. Serviços observados em produção

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

## 4. Arquivos críticos

Atendimento público:

- `apps/api/src/customer-service-agent.ts`
- `apps/api/src/customer-service-agent.test.ts`
- `apps/api/src/customer-service-knowledge.ts`
- `apps/api/src/customer-service-policy.ts`
- `apps/api/src/customer-service-policy.test.ts`
- `apps/api/src/customer-service-rules.ts`
- `apps/api/src/customer-service-rules.test.ts`
- `apps/api/src/customer-service-workflow.test.ts`
- `apps/api/src/customer-service-telegram-workflow.test.ts`
- `apps/api/src/server.ts`
- `infrastructure/n8n/workflows/20-atendimento-whatsapp.json`
- `infrastructure/n8n/workflows/30-atendimento-telegram.json`

Documentação:

- `docs/momento-presidiario.md`
- `docs/OPERACAO-MOMENTO-PRESIDIARIO.md`
- `docs/architecture/ATENDIMENTO-WHATSAPP.md`
- `docs/architecture/ATENDIMENTO-TELEGRAM.md`
- `docs/AGENTE-WHATSAPP-LOCAL.md`
- `docs/OBSERVABILIDADE-E-RECUPERACAO.md`

Operação:

- `scripts/check-production-health.sh`
- `scripts/monitor-production-health.sh`

## 5. Base institucional — Momento do Presidiário

- Organização: UNP — Universal nos Presídios.
- Igreja: Igreja Universal do Reino de Deus.
- Rádio: Rede Aleluia FM 95.9.
- Programa: segunda a sexta, 21h–22h.
- Feriados: programa gravado.
- WhatsApp público: `(71) 99185-6704`.
- Participação ao vivo: `(71) 3432-9110`, durante o programa.
- Atendimento espiritual: `(71) 3432-9119`.
- Catedral da Fé: domingos 9h30, Av. Antônio Carlos Magalhães, 4197, Iguatemi, Salvador - BA.

Apresentadores informados:

- Bispo Sérgio Simplício
- Pastor Moraes
- Missionária Lilian Moraes

## 6. Regras de áudio

1. Até 20 segundos.
2. Envio entre 21h e 22h.
3. Telegram é canal oficial/preferencial.
4. No Telegram, orientar que o áudio pode ser enviado “por aqui mesmo”.
5. WhatsApp também recebe quando anunciado.
6. Texto não é lido no ar.
7. Seleção é manual pela equipe.
8. Assistente não escolhe, agenda nem promete transmissão.
9. Não garantir data específica, inclusive aniversário.
10. Um áudio por dia por pessoa.
11. Ao receber mídia/áudio, não responder automaticamente.
12. Se perguntarem o que falar, orientar mensagem de carinho e conforto.

Não inventar username ou link do Telegram. O repositório não contém um identificador oficial confirmado.

## 7. Horário do atendimento automático

Timezone: `America/Bahia`.

- segunda a sexta fora de 21h–22h: atende;
- segunda a sexta 21h–22h: suspenso;
- sábado e domingo: atende;
- feriado: atende e, quando pertinente, informa que o programa é gravado.

Feriados locais implementados incluem 24/06, 02/07 e 08/12, além de nacionais/móveis previstos no workflow.

## 8. Regras determinísticas e sociais

`customer-service-rules.ts` deve resolver sem Gemini sempre que possível:

- saudação;
- envio e horário de áudio;
- Telegram;
- telefone ao vivo;
- atendimento pastoral;
- texto não lido no ar;
- dúvidas jurídicas/processuais;
- como ouvir;
- horário do programa;
- Catedral da Fé;
- UNP;
- agradecimentos e encerramentos;
- datas específicas.

Exemplos importantes:

- `Obrigada` -> resposta curta de bênção.
- `Amém` em sessão existente -> `silent: true`.
- `Certo`, `Entendi`, `Tá bom`, `Combinado` -> silêncio em sessão existente.
- pontuação isolada -> silêncio.

## 9. Gemini e fallback

Gemini só atende perguntas abertas não cobertas deterministicamente.

Variáveis:

- `GEMINI_API_KEY`
- `GEMINI_API_URL`
- `GEMINI_MODEL`
- `GEMINI_PLANNER_MODEL`
- `GEMINI_RATE_LIMIT_COOLDOWN_SECONDS`

Histórico: até 10 mensagens. Timeout público: 20 segundos.

Contrato de falha pública:

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

Nunca reintroduzir mensagem como “No momento não consegui concluir...” sem decisão explícita.

## 10. Workflow 20 — WhatsApp público

Nós:

1. `Webhook`
2. `Preparar atendimento`
3. `Responder?`
4. `Consultar atendimento`
5. `Registrar contexto`
6. `Preparar resposta`
7. `Responder WhatsApp`

Proteções:

- instância correta;
- ignora `fromMe`;
- ignora grupos;
- ignora mídia;
- deduplica messageId por 15 minutos;
- mantém sessão/histórico;
- respeita horário do programa;
- respeita `assistant.silent`;
- não acessa banco.

## 11. Workflow 30 — Telegram público

Nós:

1. `Telegram Trigger`
2. `Preparar atendimento`
3. `Responder?`
4. `Consultar atendimento`
5. `Registrar contexto`
6. `Preparar resposta`
7. `Responder Telegram`

Características:

- `active: false` no arquivo versionado;
- exige credencial Telegram API configurada no n8n;
- credencial nunca deve ir ao Git;
- somente chat privado;
- ignora `from.is_bot`;
- ignora mídia automaticamente;
- deduplica por chat/message;
- sessão independente do WhatsApp;
- adapta apenas linguagem específica do canal;
- usa a mesma rota pública e a mesma política de segurança.

## 12. Sessões, deduplicação e `silent`

WhatsApp usa chave baseada em instância + remoteJid. Telegram usa `telegram:<chat_id>`.

Deduplicação: TTL de 15 minutos.

Sessões: aproximadamente 30 minutos, histórico limitado a 10 itens.

`assistant.silent=true` significa atualizar contexto quando apropriado e encerrar sem enviar resposta.

## 13. Segurança SQL

Somente o agente administrativo pode usar o caminho SQL.

Proteções testadas incluem:

- SELECT autorizado;
- bloqueio de `SELECT *`;
- colunas protegidas;
- DELETE/UPDATE/UNION;
- múltiplas instruções;
- comentários;
- `SLEEP`;
- JOIN autorizado;
- LIMIT controlado;
- resolução por ID.

Workflow 20 e workflow 30 nunca devem chamar `/internal/assistant/query`.

## 14. Incidentes importantes

### Fallback técnico repetido

Gemini apresentou rejeições rápidas e timeouts de ~20 s. O fallback público foi alterado para `silent: true`. Não reverter.

### `Identifier 'state' has already been declared`

O workflow 20 já falhou por declaração duplicada de `const state` em Code Node. Há teste de sintaxe. Code Nodes devem ser testados envolvidos por função assíncrona, pois contêm `return`:

```js
new vm.Script(`(async () => {\n${code}\n})()`)
```

### PostgreSQL via shell

Executar `psql -U "$POSTGRES_USER"` pode usar `root` se a variável não estiver carregada no shell. Leia `.env` ou execute dentro do container com as variáveis corretas.

### n8n Python runner

Mensagem de Python 3 ausente no task runner interno foi observada. Os workflows DOMO aqui usam JavaScript; não confundir esse aviso com falha do atendimento.

## 15. Testes e validação

Baseline antes do Telegram: **101 testes aprovados**, typecheck e build verdes.

O branch Telegram adiciona testes estruturais próprios; o total esperado aumenta após integração.

Comandos obrigatórios:

```bash
cd ~/domo-platform/apps/api
npm test
npm run typecheck
npm run build

cd ~/domo-platform
git diff --check
git status --short
```

Após deploy da API:

```bash
curl -fSs http://127.0.0.1:3001/health
curl -fSs http://127.0.0.1:5678/healthz
```

## 16. Deploy do workflow 20

Antes de importar, exporte backup do workflow ativo. Preserve ID `VAhyWtgWl6kzU8gL` e webhookId `5a44db51-36ba-440d-878b-fb01678a921b`.

Após import/publish, reinicie n8n se necessário e confirme `webhook_entity` e HTTP 200 do webhook.

## 17. Deploy inicial do workflow 30

O workflow Telegram é novo e não deve ser ativado automaticamente por commit.

Procedimento:

1. atualizar o clone local para o commit integrado;
2. importar `infrastructure/n8n/workflows/30-atendimento-telegram.json`;
3. criar/selecionar credencial **Telegram API** com token do BotFather;
4. associar a credencial a `Telegram Trigger` e `Responder Telegram`;
5. manter `DOMO API Internal` no HTTP Request;
6. testar manualmente;
7. ativar/publicar somente depois dos testes;
8. confirmar execução no n8n e resposta no Telegram.

Consulte `docs/architecture/ATENDIMENTO-TELEGRAM.md` para checklist detalhado.

## 18. Git e documentação

`HANDOFF-DOMO-PLATFORM.md` é o único handoff canônico.

Não criar novos arquivos `HANDOFF-DOMO-PLATFORM-AAAA-MM-DD.md`. Mudanças futuras devem atualizar este arquivo; o histórico do Git já preserva versões antigas.

## 19. Critérios de pronto

Uma mudança no atendimento público só está pronta quando:

- testes passam;
- typecheck passa;
- build passa;
- `git diff --check` passa;
- API saudável;
- n8n saudável;
- workflow correspondente está publicado/ativo quando aplicável;
- canal real foi testado;
- não houve regressão no outro canal;
- fallback técnico não aparece ao público;
- handoff foi atualizado.

## 20. Próxima ação operacional do Telegram

O código/versionamento pode ser concluído sem segredo, mas o bot real só passa a responder depois que o operador configurar no n8n a credencial Telegram API correspondente ao bot oficial e ativar o workflow 30.

Não há token de bot no repositório e ele não deve ser adicionado.
