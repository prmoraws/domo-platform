# Operação — Momento do Presidiário

Ambiente: produção.

## Componentes

- Evolution: domo-atendimento
- WhatsApp: (71) 99185-6704
- n8n: DOMO - 20 - Atendimento WhatsApp
- Workflow ID: VAhyWtgWl6kzU8gL
- Webhook: domo-atendimento-inbound
- API: POST /internal/customer-service/query
- Timezone: America/Bahia

## Regras

- Áudio: máximo 20 segundos.
- Envio de áudio: entre 21h e 22h.
- Áudio não recebe resposta automática.
- Seleção dos áudios é manual.
- Texto não é lido no ar.
- Imagem, vídeo, documento e figurinha não recebem resposta.
- Seg-sex, 21h–22h, em dia útil comum: atendimento automático suspenso.
- Sábados, domingos e feriados: atendimento ativo.
- Em feriados o programa é gravado.

## Telefones

- Ao vivo: (71) 3432-9110
- Atendimento espiritual: (71) 3432-9119

## n8n

Preservar:

- Workflow ID: VAhyWtgWl6kzU8gL
- webhookId: 5a44db51-36ba-440d-878b-fb01678a921b
- webhookPath: domo-atendimento-inbound

Depois de importar uma nova versão:

docker compose exec -T n8n n8n publish:workflow --id=VAhyWtgWl6kzU8gL
docker compose restart n8n

Sempre validar HTTP 200 no webhook antes de encerrar manutenção.

## Testes

cd ~/domo-platform/apps/api
npm test
npm run typecheck
npm run build

Baseline: 76 testes aprovados.

## Segurança

Nunca versionar .env, tokens, API keys, senhas, sessões WhatsApp,
QR Codes ou credenciais do n8n.

O assistente público nunca deve acessar o banco administrativo.
