# Atendimento Telegram — Momento do Presidiário

## Objetivo

O Telegram é um segundo canal do mesmo atendimento público do Momento do Presidiário. Ele não possui um segundo agente, uma segunda base de conhecimento ou acesso ao banco de dados.

Fluxo:

```text
Telegram Bot
  -> n8n: DOMO - 30 - Atendimento Telegram
  -> POST http://api:3001/internal/customer-service/query
  -> regras determinísticas / Gemini
  -> n8n
  -> Telegram Bot
```

O WhatsApp continua no workflow 20 e o agente administrativo continua no workflow 10.

## Arquivo versionado

`infrastructure/n8n/workflows/30-atendimento-telegram.json`

O workflow fica versionado com `active: false` porque a credencial real do bot não deve ser armazenada no Git.

## Credencial necessária

Crie no n8n uma credencial do tipo **Telegram API** usando o token fornecido pelo BotFather. Não coloque o token em JSON, documentação, `.env.example`, commit ou log.

Depois de importar o workflow 30, associe a mesma credencial Telegram aos dois nós:

- `Telegram Trigger`
- `Responder Telegram`

O nó `Consultar atendimento` deve continuar usando a credencial existente `DOMO API Internal`.

## Ativação

1. Faça backup dos workflows ativos antes da mudança.
2. Importe `30-atendimento-telegram.json`.
3. Abra o workflow `DOMO - 30 - Atendimento Telegram`.
4. Configure a credencial Telegram no trigger e no nó de resposta.
5. Faça um teste manual com o bot antes de ativar.
6. Ative/publice o workflow somente depois do teste.
7. Reinicie somente o n8n se a versão em produção exigir restart para aplicar publicação.

## Regras do canal

- somente chat privado recebe resposta automática;
- mensagens de bot são ignoradas;
- grupos são ignorados;
- texto elegível é enviado ao mesmo `/internal/customer-service/query` usado pelo WhatsApp;
- áudio/voice, imagem, vídeo, documento e sticker não recebem resposta automática;
- o áudio continua disponível no Telegram para tratamento manual pela equipe;
- mensagens são deduplicadas por `telegram:<chat_id>:<message_id>`;
- sessões usam `telegram:<chat_id>` e não se misturam com sessões WhatsApp;
- `assistant.silent=true` encerra sem enviar mensagem;
- falha pública do Gemini continua silenciosa;
- em dias úteis, o atendimento automático continua suspenso durante a janela do programa, 21h–22h, seguindo a política do workflow 20.

## Linguagem específica do Telegram

A API mantém as regras institucionais centralizadas. O workflow 30 adapta apenas frases de canal para evitar respostas estranhas como “envie pelo Telegram” quando a pessoa já está no Telegram.

Exemplo esperado:

> Você pode enviar o áudio por aqui mesmo, pelo Telegram, que é o canal oficial do Momento do Presidiário.

O WhatsApp continua informando que o Telegram é o canal oficial/preferencial e que o WhatsApp recebe os áudios quando anunciado.

## Segurança

O workflow Telegram jamais deve chamar:

- `/internal/assistant/query`;
- MariaDB/MySQL;
- ferramentas SQL;
- agente administrativo.

O atendimento público permanece isolado do banco.

## Testes

A estrutura do workflow é coberta por:

`apps/api/src/customer-service-telegram-workflow.test.ts`

Antes de publicar mudanças:

```bash
cd ~/domo-platform/apps/api
npm test
npm run typecheck
npm run build

cd ~/domo-platform
git diff --check
```

## Teste operacional mínimo

Depois de configurar o bot:

1. `Olá` -> saudação do programa.
2. `Por onde envio o áudio?` -> orientação contextualizada para Telegram.
3. `Ainda recebe áudio aqui?` -> orientação do canal.
4. `Amém` em sessão existente -> nenhuma resposta.
5. Enviar áudio/voice -> nenhuma resposta automática.
6. Mensagem em grupo -> nenhuma resposta automática.
7. Pergunta aberta -> resposta via agente público; se Gemini falhar, não enviar fallback técnico.

Não ativar o workflow se qualquer um desses testes falhar.
