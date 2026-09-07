# HANDOFF TÉCNICO — DOMO PLATFORM

**Documento canônico. Atualizado em 2026-09-07.**

Repositório: `prmoraws/domo-platform`  
Branch de produção: `main`

> Este é o único handoff ativo do projeto. Handoffs datados antigos devem ser consultados apenas pelo histórico do Git.

## 0. Regras para qualquer agente de IA

Este projeto está em uso real. Antes de alterar qualquer coisa:

1. Leia este handoff e a documentação em `docs/`.
2. Rode `git status --short` e confira os commits recentes.
3. Não misture o agente administrativo com o atendimento público.
4. Atendimento público nunca acessa MariaDB/MySQL nem o agente SQL.
5. Não exponha tokens, chaves, senhas, JIDs, conteúdo privado ou respostas brutas de provedores.
6. Faça backup de workflow n8n ativo antes de importar/substituir.
7. Preserve IDs e webhookIds dos workflows existentes.
8. Rode `npm test`, `npm run typecheck`, `npm run build` em `apps/api` após mudanças TypeScript.
9. Rode `git diff --check` antes de commit.
10. Falha do Gemini no atendimento público deve permanecer silenciosa.
11. Regras operacionais de Salvador/Bahia têm prioridade sobre informação genérica.
12. Não reinicie todos os serviços como primeira tentativa de recuperação; identifique o componente com falha.
13. Nunca tocar na Agenda (`~/agenda`) a partir de scripts do DOMO.
14. Atualize este handoff após mudanças arquiteturais, operacionais ou institucionais.

## 1. Arquitetura

DOMO Platform usa Node.js/TypeScript, n8n, Evolution API, PostgreSQL, Redis, MariaDB réplica somente leitura, Gemini, Ollama e Tailscale.

Há três fluxos separados.

### 1.1 WhatsApp administrativo

- Evolution: `domo-assistente`
- n8n: `DOMO - 10 - Entrada WhatsApp`
- workflow ID: `gseL5lW5viEgNEWQ`
- webhook: `domo-whatsapp-inbound`
- API: `POST /internal/assistant/query`
- pode consultar a réplica somente leitura por meio do agente SQL seguro.

### 1.2 WhatsApp público — Momento do Presidiário

- Evolution: `domo-atendimento`
- WhatsApp: `(71) 99185-6704`
- n8n: `DOMO - 20 - Atendimento WhatsApp`
- workflow ID: `VAhyWtgWl6kzU8gL`
- webhook path: `domo-atendimento-inbound`
- webhookId: `5a44db51-36ba-440d-878b-fb01678a921b`
- API: `POST /internal/customer-service/query`
- não acessa banco.

### 1.3 Telegram público — Momento do Presidiário

- n8n: `DOMO - 30 - Atendimento Telegram`
- workflow ID operacional: `DOMO30TELEGRAM01`
- arquivo: `infrastructure/n8n/workflows/30-atendimento-telegram.json`
- API: `POST /internal/customer-service/query`
- URL pública: `https://domo-n8n.tailbd3b60.ts.net/`
- usa a mesma base institucional e as mesmas regras do WhatsApp;
- sessões: `telegram:<chat_id>`;
- deduplicação: `telegram:<chat_id>:<message_id>`;
- somente chats privados respondem;
- mídia/áudio não recebe resposta automática;
- grupos e mensagens de bots são ignorados;
- `silent` e fallback silencioso são preservados;
- credencial do bot existe somente no n8n.

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
 -> HTTPS Tailscale Funnel
 -> workflow 30
 -> /internal/customer-service/query
 -> regras determinísticas ou Gemini
 -> Telegram Bot
```

Nunca criar um segundo “cérebro” para Telegram. Conhecimento e política ficam centralizados na API.

## 3. Infraestrutura observada

Serviços:

- `domo-api`
- `domo-evolution`
- `domo-evolution-postgres`
- `domo-evolution-redis`
- `domo-mariadb-replica`
- `domo-n8n`
- `domo-ollama`
- `domo-postgres`
- `domo-tailscale-n8n`

Versões observadas:

- Evolution `v2.3.7`
- n8n `2.33.4`
- PostgreSQL `17-alpine`
- Redis `7.4-alpine`
- MariaDB `10.11.18`
- Ollama `0.32.6`
- Tailscale `1.102.3`
- API DOMO `0.1.0`

Portas locais:

- API `127.0.0.1:3001`
- Evolution `127.0.0.1:8080`
- n8n `127.0.0.1:5678`
- MariaDB réplica `127.0.0.1:3307`
- Ollama `127.0.0.1:11434`

## 4. Tailscale Funnel do DOMO

O DOMO possui nó Tailscale próprio:

- container: `domo-tailscale-n8n`
- hostname: `domo-n8n`
- DNS: `domo-n8n.tailbd3b60.ts.net`
- volume: `domo-tailscale-n8n-state`
- configuração: `infrastructure/tailscale/n8n/serve.json`

Handlers:

```text
/webhook/      -> http://n8n:5678/webhook/
/webhook-test/ -> http://n8n:5678/webhook-test/
```

O editor n8n continua local em `http://localhost:5678`.

Para n8n 2.33.4 usar:

```text
N8N_WEBHOOK_URL=https://domo-n8n.tailbd3b60.ts.net/
```

Não usar `WEBHOOK_URL`; esta versão do n8n emite aviso para usar `N8N_WEBHOOK_URL`.

### Agenda é separada

A Agenda usa outro projeto e outro nó Tailscale:

```text
~/agenda
agenda.tailbd3b60.ts.net
agenda-tailscale
agenda_tailscale_state
```

Nenhum script do DOMO deve reiniciar, alterar ou reutilizar componentes da Agenda.

## 5. Arquivos críticos

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

Operação:

- `infrastructure/tailscale/n8n/serve.json`
- `scripts/deploy-telegram-workflow.sh`
- `scripts/recover-public-access.sh`
- `scripts/check-production-health.sh`
- `scripts/monitor-production-health.sh`
- `infrastructure/systemd/domo-access-recovery.service`
- `infrastructure/systemd/domo-access-recovery.timer`

Documentação:

- `docs/momento-presidiario.md`
- `docs/OPERACAO-MOMENTO-PRESIDIARIO.md`
- `docs/architecture/ATENDIMENTO-WHATSAPP.md`
- `docs/architecture/ATENDIMENTO-TELEGRAM.md`
- `docs/AGENTE-WHATSAPP-LOCAL.md`
- `docs/OBSERVABILIDADE-E-RECUPERACAO.md`

## 6. Base institucional — Momento do Presidiário

- Organização: UNP — Universal nos Presídios.
- Igreja: Igreja Universal do Reino de Deus.
- Rádio: Rede Aleluia FM 95.9.
- Programa: segunda a sexta, 21h–22h.
- Feriados: programa gravado.
- WhatsApp público: `(71) 99185-6704`.
- Participação ao vivo: `(71) 3432-9110` durante o programa.
- Atendimento espiritual: `(71) 3432-9119`.
- Catedral da Fé: domingos 9h30, Av. Antônio Carlos Magalhães, 4197, Iguatemi, Salvador - BA.

## 7. Regras de áudio

1. Até 20 segundos.
2. Envio entre 21h e 22h.
3. Telegram é canal oficial/preferencial.
4. No Telegram, orientar que pode enviar “por aqui mesmo”.
5. WhatsApp também recebe quando anunciado.
6. Texto não é lido no ar.
7. Seleção é manual.
8. Assistente não escolhe, agenda nem promete transmissão.
9. Não garantir data específica, inclusive aniversário.
10. Um áudio por dia por pessoa.
11. Ao receber áudio/mídia, não responder automaticamente.
12. Se perguntarem o que falar, orientar mensagem de carinho e conforto.

Não inventar username ou link oficial do Telegram se não estiver documentado.

## 8. Horário do atendimento automático

Timezone: `America/Bahia`.

- segunda a sexta fora de 21h–22h: atende;
- segunda a sexta 21h–22h: suspenso;
- sábado e domingo: atende;
- feriado: atende e, quando pertinente, informa programa gravado.

Feriados locais já cobertos incluem 24/06, 02/07 e 08/12, além de nacionais/móveis implementados.

## 9. Regras determinísticas e sociais

`customer-service-rules.ts` resolve sem Gemini sempre que possível:

- saudação;
- envio/horário de áudio;
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

Exemplos:

- `Obrigada` -> resposta curta;
- `Amém` em sessão existente -> `silent: true`;
- `Certo`, `Entendi`, `Tá bom`, `Combinado` -> silêncio;
- pontuação isolada -> silêncio.

## 10. Gemini e fallback

Gemini só atende perguntas abertas não cobertas deterministicamente.

Histórico: até 10 mensagens. Timeout público: 20 segundos.

Falha pública deve retornar `silent: true` e resposta vazia. Nunca reintroduzir o fallback técnico repetitivo sem decisão explícita.

## 11. Workflow 20 — WhatsApp público

Nós:

1. `Webhook`
2. `Preparar atendimento`
3. `Responder?`
4. `Consultar atendimento`
5. `Registrar contexto`
6. `Preparar resposta`
7. `Responder WhatsApp`

Proteções: instância correta, `fromMe`, grupo, mídia, dedup, sessão, horário, `silent`, sem banco.

## 12. Workflow 30 — Telegram público

Nós:

1. `Telegram Trigger`
2. `Preparar atendimento`
3. `Responder?`
4. `Consultar atendimento`
5. `Registrar contexto`
6. `Preparar resposta`
7. `Responder Telegram`

O JSON versionado pode permanecer `active:false`; o script de deploy prepara ID estável `DOMO30TELEGRAM01`, valida credenciais, publica e ativa a instância operacional.

## 13. Telegram — estado validado em produção

Em 2026-09-07 foram validados:

- workflow `DOMO30TELEGRAM01` com `active=true`;
- `Olá` -> saudação;
- `Por onde eu mando o áudio?` -> resposta contextualizada;
- `Que horas posso mandar?` -> 21h–22h;
- `Ainda recebe áudio pelo Telegram?` -> confirmação;
- `Amém` -> nenhuma resposta;
- áudio de teste -> nenhuma resposta automática;
- execuções recentes do workflow 30 -> `success`;
- n8n saudável;
- API saudável;
- Funnel ativo.

## 14. Deploy do Telegram

Fluxo recomendado:

```bash
./scripts/deploy-telegram-workflow.sh import
./scripts/deploy-telegram-workflow.sh verify
./scripts/deploy-telegram-workflow.sh publish
```

A credencial Telegram API deve existir somente no n8n e ser associada a `Telegram Trigger` e `Responder Telegram`.

## 15. Recuperação automática do DOMO

Script:

```text
scripts/recover-public-access.sh
```

Timer de usuário:

```text
infrastructure/systemd/domo-access-recovery.service
infrastructure/systemd/domo-access-recovery.timer
```

Instalação operacional:

```bash
mkdir -p ~/.config/systemd/user
cp infrastructure/systemd/domo-access-recovery.service ~/.config/systemd/user/
cp infrastructure/systemd/domo-access-recovery.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now domo-access-recovery.timer
```

O timer roda aproximadamente a cada minuto e verifica:

- Docker;
- API;
- n8n;
- Tailscale;
- Funnel;
- workflows 10, 20 e 30 ativos;
- webhooks WhatsApp locais;
- webhook público via Funnel.

Só reinicia o componente defeituoso. Não toca na Agenda.

Log:

```text
~/.local/state/domo/public-access-recovery.log
```

Estado validado:

```text
status=0/SUCCESS
OK DOMO operacional: API, n8n, workflows e Funnel.
```

## 16. Recuperação da Agenda

A Agenda possui mecanismo próprio em `~/agenda`, com `agenda-access-recovery.timer`. Ele não pertence ao repositório DOMO.

Após suspensão/reinício, os dois projetos se recuperam por timers separados quando o WSL/systemd estão ativos.

Um reboot completo do Windows ainda depende de o WSL/Docker Desktop serem iniciados. Uma tarefa do Agendador de Tarefas do Windows pode ser adicionada futuramente para automatizar essa última camada.

## 17. Segurança SQL

Somente o agente administrativo usa SQL.

Proteções testadas incluem SELECT autorizado, bloqueio de `SELECT *`, colunas protegidas, DELETE, UPDATE, UNION, múltiplas instruções, comentários, `SLEEP`, JOIN autorizado, LIMIT e resolução por ID.

Workflows 20 e 30 nunca devem chamar `/internal/assistant/query`.

## 18. Incidentes conhecidos

### Fallback técnico repetido

Corrigido com `silent: true`. Não reverter.

### `Identifier 'state' has already been declared`

Workflow 20 já falhou por declaração duplicada em Code Node. Testes de sintaxe devem envolver o código em função assíncrona para permitir `return`.

### `webhookId` perdido no workflow 20

Preservar `5a44db51-36ba-440d-878b-fb01678a921b`; perda do ID já causou path incorreto e 404.

### Telegram exigindo HTTPS

Causa: Telegram rejeita webhook HTTP. Resolvido com Tailscale Funnel.

### n8n gerando localhost apesar do Funnel

Em n8n 2.33.4 a variável correta é `N8N_WEBHOOK_URL`. Usar `WEBHOOK_URL` manteve Test URL em `http://localhost:5678` e gerou erro do Telegram.

### Tailscale path retornando 404

O proxy deve preservar os prefixos:

```text
/webhook/ -> http://n8n:5678/webhook/
/webhook-test/ -> http://n8n:5678/webhook-test/
```

### Python runner n8n

Aviso de Python 3 ausente não é causa dos workflows atuais, que usam JavaScript.

## 19. Testes

Último baseline confirmado antes do fechamento operacional do Telegram:

- tests: `108`
- fail: `0`
- typecheck: `0`
- build: `0`

Comandos:

```bash
cd ~/domo-platform/apps/api
npm test
npm run typecheck
npm run build

cd ~/domo-platform
git diff --check
git status --short
```

## 20. Diagnóstico ponta a ponta

Quando WhatsApp ou Telegram não responder:

1. confirme Docker;
2. confira Evolution para WhatsApp;
3. confira execução n8n;
4. confira logs da API;
5. confira Tailscale/Funnel para Telegram;
6. confira workflow ativo;
7. não reinicie todos os serviços sem identificar o elo quebrado.

Comandos úteis:

```bash
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:5678/healthz
docker compose exec -T tailscale-n8n tailscale funnel status
docker compose exec -T n8n n8n list:workflow
```

## 21. Git

Nunca commit:

- `.env`;
- tokens Telegram/Tailscale/Evolution/Gemini;
- senhas;
- logs privados;
- backups com credenciais;
- dados pessoais.

Fluxo:

```bash
git status --short
git diff --check
git add <arquivos>
git diff --cached --stat
git commit -m "..."
git push
```

## 22. Critério de pronto

Uma mudança só está pronta quando:

- teste de regressão passa;
- typecheck passa;
- build passa;
- workflow e API estão saudáveis;
- canal real foi testado;
- logs não mostram erro relevante;
- documentação e este handoff foram atualizados;
- GitHub reflete o estado operacional sem segredos.

## 23. Prompt para outro agente de IA

> Leia integralmente `HANDOFF-DOMO-PLATFORM.md` e a documentação em `docs/`. Este sistema está em uso real. Não misture o agente administrativo com os atendimentos públicos. Preserve workflow 20 `VAhyWtgWl6kzU8gL`, webhookId `5a44db51-36ba-440d-878b-fb01678a921b` e workflow Telegram operacional `DOMO30TELEGRAM01`. O Telegram usa `https://domo-n8n.tailbd3b60.ts.net/` via Tailscale Funnel e n8n 2.33.4 exige `N8N_WEBHOOK_URL`. O DOMO possui recovery automático próprio e jamais deve tocar em `~/agenda`. Antes de alterações, rode `git status --short`; depois, teste, typecheck, build, `git diff --check`, deploy controlado e validação ponta a ponta. Nunca exponha segredos.
