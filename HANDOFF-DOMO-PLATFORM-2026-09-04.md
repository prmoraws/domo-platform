# HANDOFF — DOMO PLATFORM

Ambiente: PRODUÇÃO
Branch: main
Data-base: 04/09/2026

## Visão geral

A DOMO Platform possui dois fluxos WhatsApp independentes.

### Agente administrativo

- Evolution: domo-assistente
- n8n: DOMO - 10 - Entrada WhatsApp
- Workflow ID: gseL5lW5viEgNEWQ
- Webhook: domo-whatsapp-inbound
- API: POST /internal/assistant/query
- Banco: MariaDB somente leitura

### Atendimento público

- Evolution: domo-atendimento
- WhatsApp: (71) 99185-6704
- n8n: DOMO - 20 - Atendimento WhatsApp
- Workflow ID: VAhyWtgWl6kzU8gL
- Webhook: domo-atendimento-inbound
- webhookId: 5a44db51-36ba-440d-878b-fb01678a921b
- API: POST /internal/customer-service/query

O atendimento público nunca deve acessar o banco administrativo.

## Momento do Presidiário

Organização: UNP — Universal nos Presídios.
Rádio: Rede Aleluia FM 95.9.
Programa: segunda a sexta-feira, 21h às 22h.

WhatsApp: (71) 99185-6704
Ao vivo: (71) 3432-9110
Pastor / atendimento espiritual: (71) 3432-9119

## Áudios

- máximo 20 segundos;
- enviar entre 21h e 22h;
- nenhuma resposta automática;
- seleção manual;
- não prometer transmissão.

Se perguntarem o que falar, orientar mensagem de carinho e conforto.

## Horário automático

Timezone: America/Bahia.

Dia útil comum:
- antes das 21h: ativo;
- 21h–21h59: suspenso;
- 22h em diante: ativo.

Sábado, domingo e feriado: ativo.

Em feriados, o programa é gravado.

## Questões jurídicas e prisionais

A igreja presta assistência espiritual.

Não há acesso a processos, audiências, alvarás, transferências,
solturas, prontuários ou dados internos do sistema prisional.

Orientar advogado ou assistente social da unidade.

## Segmentação da UNP

Ao atender familiares de pessoas privadas de liberdade, manter o foco
em presos e familiares.

Não acrescentar espontaneamente agentes, policiais penais ou
funcionários do sistema prisional.

## Código

apps/api/src/customer-service-agent.ts
apps/api/src/customer-service-agent.test.ts
apps/api/src/customer-service-knowledge.ts
apps/api/src/customer-service-policy.ts
apps/api/src/customer-service-policy.test.ts
apps/api/src/customer-service-rules.ts
apps/api/src/customer-service-rules.test.ts
apps/api/src/server.ts
infrastructure/n8n/workflows/20-atendimento-whatsapp.json

## Baseline validado

76 testes
76 aprovados
0 falhas
typecheck 0
build 0

## Verificação

docker compose ps
curl -fSs http://127.0.0.1:3001/health
curl -fSs http://127.0.0.1:5678/healthz
docker compose exec -T n8n n8n list:workflow

## Workflow 20

Preservar sempre:

Workflow ID:
VAhyWtgWl6kzU8gL

webhookId:
5a44db51-36ba-440d-878b-fb01678a921b

webhook:
domo-atendimento-inbound

Após importação:

docker compose exec -T n8n n8n publish:workflow --id=VAhyWtgWl6kzU8gL
docker compose restart n8n

Depois testar os webhooks 10 e 20.

## Reconstrução em outro servidor

1. instalar Docker e Docker Compose;
2. restaurar o repositório;
3. restaurar .env de forma segura;
4. restaurar PostgreSQL;
5. restaurar MariaDB;
6. subir a stack;
7. importar/publicar workflows;
8. restaurar credenciais n8n;
9. preservar IDs e webhookIds;
10. conectar as instâncias Evolution;
11. configurar webhooks;
12. executar os testes;
13. validar workflow 10;
14. validar workflow 20;
15. validar silêncio para mídias;
16. validar regra 21h–22h.

## Git

Branch atual: main.

No momento deste handoff não havia remote configurado.
Não inventar endereço de repositório remoto.

## Prompt para outra IA

Você está assumindo a DOMO Platform em produção.

Leia este handoff e os documentos em docs/ antes de modificar qualquer
componente.

Primeiro inspecione:
- git status
- docker compose ps
- health da API
- health do n8n
- workflows n8n
- instâncias Evolution

Preserve a separação entre domo-assistente e domo-atendimento.

O assistente público nunca deve acessar o banco administrativo.

No workflow 20 preserve:
- VAhyWtgWl6kzU8gL
- 5a44db51-36ba-440d-878b-fb01678a921b
- domo-atendimento-inbound

Antes de mudar produção, defina backup e rollback.

Após mudanças na API execute:
npm test
npm run typecheck
npm run build

Não invente regras institucionais de Salvador/Bahia.

## Regra operacional

observar → backup → alterar → testar → validar → documentar → Git
