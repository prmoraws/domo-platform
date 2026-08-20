# Agente DOMO e sessão WhatsApp local

## Estado deste bloco

- Agente Gemini baseado em ferramentas e catálogo dinâmico.
- Consultas executadas somente pelo gateway `SELECT` validado.
- Entidades exatas devem ser filtradas pelo ID resolvido.
- `describe_table` inspeciona uma única tabela sem reenviar todo o catálogo.
- Respostas da API informam quantidade de chamadas e duração do agente.
- Limites `429` ativam bloqueio local temporário, evitando novas chamadas inúteis.
- Workflow WhatsApp permanece `active: false` até importação e teste manual.

## Variáveis novas

```dotenv
GEMINI_RATE_LIMIT_COOLDOWN_SECONDS=60
DOMO_WHATSAPP_SESSION_MINUTES=20
```

`GEMINI_RATE_LIMIT_COOLDOWN_SECONDS` aceita valores entre 0 e 3600.
`DOMO_WHATSAPP_SESSION_MINUTES` aceita valores entre 5 e 120.

## Sessão WhatsApp

- `domo:` abre a sessão.
- Uma pergunta junto ao prefixo abre/renova a sessão e consulta o agente.
- Durante a sessão, as mensagens seguintes dispensam o prefixo.
- `domo: sair`, `domo: encerrar` ou `domo: fim` encerra a sessão.
- A sessão expira automaticamente por inatividade.
- A sessão é vinculada à instância e ao `remoteJid` autorizados.
- O estado global do workflow é persistido pelo n8n em seu PostgreSQL.
- Respostas acima de 3500 caracteres são truncadas com aviso explícito.

## Validação local

```bash
cd ~/domo-platform

cd apps/api
npm test
npm run typecheck
npm run build

cd ../..
node scripts/validate-workflows.mjs
docker compose config --quiet
```

## Importação no n8n

Importar manualmente:

```text
infrastructure/n8n/workflows/10-entrada-whatsapp.json
```

Antes de publicar, confirmar as credenciais já existentes:

- `DOMO API Internal`
- `DOMO - Evolution API`

Executar primeiro com o workflow inativo e dados de teste. A importação e a
publicação não são realizadas automaticamente por este pacote.
