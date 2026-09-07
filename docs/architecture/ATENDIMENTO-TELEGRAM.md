# Atendimento Telegram — Momento do Presidiário

## Estado atual

O Telegram está implantado como segundo canal do atendimento público do Momento do Presidiário.

- Workflow: `DOMO - 30 - Atendimento Telegram`
- Workflow ID operacional: `DOMO30TELEGRAM01`
- API: `POST http://api:3001/internal/customer-service/query`
- URL pública de webhook: `https://domo-n8n.tailbd3b60.ts.net/`
- Tailscale Funnel: ativo
- Credencial Telegram: armazenada somente no n8n
- Atendimento público: isolado do agente administrativo e do banco

O bot foi validado em modo permanente, sem `Execute workflow`, com execuções `success` no n8n.

## Arquitetura

```text
Telegram Bot
  -> HTTPS público
  -> Tailscale Funnel: domo-n8n.tailbd3b60.ts.net
  -> n8n: DOMO - 30 - Atendimento Telegram
  -> POST /internal/customer-service/query
  -> regras determinísticas / Gemini
  -> n8n
  -> Telegram Bot
```

O WhatsApp público continua no workflow 20. O agente administrativo continua no workflow 10.

## Tailscale Funnel

O DOMO possui nó Tailscale próprio e não compartilha estado com a Agenda.

- container: `domo-tailscale-n8n`
- hostname Tailscale: `domo-n8n`
- URL: `https://domo-n8n.tailbd3b60.ts.net`
- volume: `domo-tailscale-n8n-state`
- configuração: `infrastructure/tailscale/n8n/serve.json`

Handlers públicos:

```text
/webhook/      -> http://n8n:5678/webhook/
/webhook-test/ -> http://n8n:5678/webhook-test/
```

O editor do n8n permanece local em `http://localhost:5678`.

Para n8n 2.33.4, a variável correta para a base externa de webhooks é:

```text
N8N_WEBHOOK_URL=https://domo-n8n.tailbd3b60.ts.net/
```

Não substituir por `WEBHOOK_URL`; essa versão do n8n emite aviso explícito para usar `N8N_WEBHOOK_URL`.

## Credencial Telegram

Criar no n8n uma credencial `Telegram API` com o token fornecido pelo BotFather.

Usar a mesma credencial nos nós:

- `Telegram Trigger`
- `Responder Telegram`

Nunca colocar o token em:

- Git
- `.env.example`
- workflow JSON
- documentação
- logs

## Regras do canal

- apenas chat privado recebe resposta automática;
- mensagens de bot são ignoradas;
- grupos são ignorados;
- texto elegível usa a mesma API pública do WhatsApp;
- áudio/voice, imagem, vídeo, documento e sticker não recebem resposta automática;
- áudio enviado pelo Telegram continua disponível para seleção manual da equipe;
- sessões: `telegram:<chat_id>`;
- deduplicação: `telegram:<chat_id>:<message_id>`;
- `assistant.silent=true` encerra sem enviar mensagem;
- falha pública do Gemini permanece silenciosa;
- segunda a sexta, 21h–22h, o atendimento automático segue a suspensão do programa, exceto regras de fim de semana/feriado já implementadas.

## Linguagem específica do Telegram

A base de conhecimento continua centralizada na API. O workflow adapta apenas frases dependentes do canal.

Exemplo:

> Você pode enviar o áudio por aqui mesmo, pelo Telegram, que é o canal oficial do Momento do Presidiário.

No WhatsApp, a resposta continua orientando o Telegram como canal preferencial e o WhatsApp quando o recebimento for anunciado.

## Testes já validados em produção

Foram validados:

- `Olá` -> saudação do programa;
- `Por onde eu mando o áudio?` -> resposta contextualizada para Telegram;
- `Que horas posso mandar?` -> 21h às 22h;
- `Ainda recebe áudio pelo Telegram?` -> confirmação do canal;
- `Amém` em sessão existente -> silêncio;
- envio de áudio -> nenhuma resposta automática;
- execuções do workflow 30 -> `success`;
- workflow 30 -> `active=true`;
- n8n -> saudável;
- API -> saudável;
- Funnel -> ativo.

## Deploy seguro

Script:

```bash
./scripts/deploy-telegram-workflow.sh import
./scripts/deploy-telegram-workflow.sh verify
./scripts/deploy-telegram-workflow.sh publish
```

O script prepara o ID estável `DOMO30TELEGRAM01` na importação, valida as credenciais e o isolamento do banco, publica, ativa e reinicia somente o n8n.

## Recuperação após suspensão/reinício

O DOMO possui recuperação independente da Agenda:

```text
scripts/recover-public-access.sh
infrastructure/systemd/domo-access-recovery.service
infrastructure/systemd/domo-access-recovery.timer
```

O timer verifica a cada minuto:

- Docker;
- API;
- n8n;
- Tailscale;
- Funnel;
- workflows 10, 20 e 30 ativos;
- webhooks WhatsApp locais;
- webhook público via Funnel.

Ele só reinicia o componente com problema.

A Agenda usa mecanismo próprio em `~/agenda` e nunca deve ser reiniciada pelo DOMO.

## Segurança

O workflow 30 nunca deve chamar:

- `/internal/assistant/query`;
- MariaDB/MySQL;
- ferramentas SQL;
- agente administrativo.

A autenticação do bot e do Tailscale deve permanecer fora do Git.
