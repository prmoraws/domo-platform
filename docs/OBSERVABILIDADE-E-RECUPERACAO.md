# Observabilidade e recuperação local da DOMO Platform

## Princípios

- Operação local em `~/domo-platform`.
- Serviços publicados somente em `127.0.0.1`.
- Logs nunca devem conter tokens, telefone completo, documentos, perguntas,
  SQL gerada ou linhas pessoais retornadas pelo banco.
- O healthcheck não realiza chamadas ao Gemini e não consome sua franquia.

## Logs do agente

Uma consulta concluída registra o evento `assistant_query_completed` com:

- `requestId`;
- provider e modelo;
- duração;
- quantidade de chamadas e iterações;
- nomes das ferramentas e sucesso;
- indicador final de sucesso.

Uma falha registra `assistant_query_failed`, código sanitizado e tempo de
retentativa, quando disponível. O cabeçalho `Authorization` é redigido.

O endpoint `/health` usa log silencioso para não produzir uma linha a cada
healthcheck do Docker.

## Verificação consolidada

```bash
cd ~/domo-platform
node scripts/healthcheck-local.mjs
```

O script verifica API, MariaDB, circuit breaker do Gemini, n8n, Evolution e
Ollama. Ele não envia perguntas ao agente.

O estado do Gemini também pode ser consultado sem consumir franquia:

```text
GET /internal/assistant/status
```

`closed` permite chamadas; `open` informa `retryAfterSeconds`.

## Backup do n8n

```bash
cd ~/domo-platform
scripts/backup-n8n-local.sh
```

O backup é salvo por padrão em:

```text
~/domo-platform-backups/n8n/AAAAMMDD-HHMMSS/
```

Ele contém:

- exportação dos workflows;
- dump customizado do PostgreSQL do n8n;
- Compose e `.env.example` sem valores secretos;
- hashes SHA-256.

O dump contém credenciais criptografadas pelo n8n. O diretório recebe
permissão `600` e não deve ser enviado ou versionado. A restauração exige o
mesmo `N8N_ENCRYPTION_KEY` guardado no `.env` local.

## Recuperação do workflow

1. Manter o workflow atual despublicado durante a recuperação.
2. Validar os hashes com `sha256sum -c SHA256SUMS`.
3. Importar `workflows.json` com `n8n import:workflow`.
4. Conferir as credenciais `DOMO API Internal` e `DOMO - Evolution API`.
5. Publicar apenas `DOMO - 10 - Entrada WhatsApp`.
6. Reiniciar o n8n e aguardar a mensagem `Activated workflow`.
7. Testar `domo:`, uma única consulta e `domo: sair`.

## Recuperação completa do PostgreSQL

Esta operação substitui dados e deve ser feita somente com o n8n parado e um
backup adicional confirmado.

1. Parar o serviço n8n.
2. Recriar um PostgreSQL vazio com as mesmas variáveis do `.env`.
3. Restaurar `n8n-postgres.dump` usando `pg_restore`.
4. Confirmar o mesmo `N8N_ENCRYPTION_KEY` antes de iniciar o n8n.
5. Iniciar o n8n, conferir os workflows e publicar somente o canônico.

Não automatizamos a restauração destrutiva para impedir substituição acidental
do banco local.
