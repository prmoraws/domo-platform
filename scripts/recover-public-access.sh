#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/home/moraws/domo-platform"
PUBLIC_HOST="domo-n8n.tailbd3b60.ts.net"
PUBLIC_WEBHOOK="https://${PUBLIC_HOST}/webhook/domo-atendimento-inbound"
WORKFLOW_10="gseL5lW5viEgNEWQ"
WORKFLOW_20="VAhyWtgWl6kzU8gL"
STATE_DIR="${HOME}/.local/state/domo"
LOG_FILE="${STATE_DIR}/public-access-recovery.log"
LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/domo-public-access-recovery.lock"

mkdir -p "$STATE_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

cd "$PROJECT_DIR"

if ! docker info >/dev/null 2>&1; then
  log "WARN Docker indisponível; nova tentativa ocorrerá pelo timer."
  exit 1
fi

if ! docker compose up -d \
  postgres mariadb api n8n \
  evolution-postgres evolution-redis evolution \
  telegram-user tailscale-n8n >/dev/null 2>&1; then
  log "ERROR Falha ao garantir serviços DOMO."
  exit 1
fi

api_ok=false
for _ in $(seq 1 12); do
  if curl -fsS --max-time 5 http://127.0.0.1:3001/health >/dev/null 2>&1; then
    api_ok=true
    break
  fi
  sleep 5
done

if [[ "$api_ok" != "true" ]]; then
  log "WARN API indisponível. Reiniciando somente API."
  docker compose restart api >/dev/null 2>&1 || true
  sleep 8
  if ! curl -fsS --max-time 5 http://127.0.0.1:3001/health >/dev/null 2>&1; then
    log "ERROR API não recuperou."
    exit 1
  fi
fi

n8n_ok=false
for _ in $(seq 1 12); do
  if curl -fsS --max-time 5 http://127.0.0.1:5678/healthz >/dev/null 2>&1; then
    n8n_ok=true
    break
  fi
  sleep 5
done

if [[ "$n8n_ok" != "true" ]]; then
  log "WARN n8n indisponível. Reiniciando somente n8n."
  docker compose restart n8n >/dev/null 2>&1 || true
  for _ in $(seq 1 12); do
    if curl -fsS --max-time 5 http://127.0.0.1:5678/healthz >/dev/null 2>&1; then
      n8n_ok=true
      break
    fi
    sleep 5
  done
fi

if [[ "$n8n_ok" != "true" ]]; then
  log "ERROR n8n não recuperou."
  exit 1
fi

tailscale_ok=false
if docker compose exec -T tailscale-n8n tailscale status --json 2>/dev/null \
  | grep -q '"BackendState": "Running"'; then
  tailscale_ok=true
fi

if [[ "$tailscale_ok" != "true" ]]; then
  log "WARN Tailscale DOMO não está Running."
  docker compose restart tailscale-n8n >/dev/null 2>&1 || true
  for _ in $(seq 1 12); do
    if docker compose exec -T tailscale-n8n tailscale status --json 2>/dev/null \
      | grep -q '"BackendState": "Running"'; then
      tailscale_ok=true
      break
    fi
    sleep 5
  done
fi

if [[ "$tailscale_ok" != "true" ]]; then
  log "ERROR Tailscale DOMO não recuperou."
  exit 1
fi

FUNNEL="$(docker compose exec -T tailscale-n8n tailscale funnel status 2>/dev/null || true)"
if ! grep -Fq "https://${PUBLIC_HOST}" <<< "$FUNNEL"; then
  log "WARN Funnel DOMO ausente. Recarregando Tailscale DOMO."
  docker compose restart tailscale-n8n >/dev/null 2>&1
  sleep 10
  FUNNEL="$(docker compose exec -T tailscale-n8n tailscale funnel status 2>/dev/null || true)"
fi

if ! grep -Fq "https://${PUBLIC_HOST}" <<< "$FUNNEL"; then
  log "ERROR Funnel DOMO continua ausente."
  exit 1
fi

POSTGRES_USER_VALUE="$(sed -n 's/^POSTGRES_USER=//p' .env | tail -1 | tr -d '\r' | sed 's/^"//;s/"$//')"
POSTGRES_DB_VALUE="$(sed -n 's/^POSTGRES_DB=//p' .env | tail -1 | tr -d '\r' | sed 's/^"//;s/"$//')"

if [[ -z "$POSTGRES_USER_VALUE" || -z "$POSTGRES_DB_VALUE" ]]; then
  log "ERROR Não foi possível identificar banco n8n."
  exit 1
fi

WORKFLOW_STATE="$(
  docker compose exec -T postgres psql \
    -U "$POSTGRES_USER_VALUE" \
    -d "$POSTGRES_DB_VALUE" \
    -At \
    -c "SELECT id || ':' || active FROM workflow_entity WHERE id IN ('$WORKFLOW_10','$WORKFLOW_20') ORDER BY id;" \
    2>/dev/null || true
)"

need_n8n_restart=false
for workflow in "$WORKFLOW_10" "$WORKFLOW_20"; do
  if ! grep -Fq "${workflow}:t" <<< "$WORKFLOW_STATE"; then
    log "WARN Workflow ${workflow} não está ativo. Ativando."
    if docker compose exec -T n8n n8n update:workflow --id="$workflow" --active=true >/dev/null 2>&1; then
      need_n8n_restart=true
    else
      log "ERROR Falha ao ativar workflow ${workflow}."
      exit 1
    fi
  fi
done

if [[ "$need_n8n_restart" == "true" ]]; then
  log "WARN Reiniciando n8n após correção de workflows."
  docker compose restart n8n >/dev/null 2>&1
  for _ in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:5678/healthz >/dev/null 2>&1; then
      break
    fi
    sleep 3
  done
fi

telegram_health="$(
  docker inspect \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    domo-telegram-user \
    2>/dev/null \
    || true
)"

if [[ "$telegram_health" != "healthy" ]]; then
  log "WARN Telegram MTProto não está saudável. Reiniciando somente telegram-user."

  docker compose restart telegram-user \
    >/dev/null 2>&1 || true

  telegram_ok=false

  for _ in $(seq 1 18); do
    telegram_health="$(
      docker inspect \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
        domo-telegram-user \
        2>/dev/null \
        || true
    )"

    if [[ "$telegram_health" == "healthy" ]]; then
      telegram_ok=true
      break
    fi

    sleep 5
  done

  if [[ "$telegram_ok" != "true" ]]; then
    log "ERROR Telegram MTProto não recuperou."
    exit 1
  fi
fi

for path in domo-whatsapp-inbound domo-atendimento-inbound; do
  code="$(
    curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' \
      "http://127.0.0.1:5678/webhook/${path}" -d '{}' 2>/dev/null \
      || printf '000'
  )"
  if [[ "$code" != "200" ]]; then
    log "ERROR Webhook local ${path} retornou HTTP=${code}."
    exit 1
  fi
done

public_ok=false
public_code="000"
for _ in $(seq 1 12); do
  public_code="$(
    curl -4 -sS --max-time 20 -o /dev/null -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' \
      "$PUBLIC_WEBHOOK" -d '{}' 2>/dev/null \
      || printf '000'
  )"
  if [[ "$public_code" == "200" ]]; then
    public_ok=true
    break
  fi
  sleep 5
done

if [[ "$public_ok" != "true" ]]; then
  log "ERROR Funnel público DOMO retornou HTTP=${public_code}."
  exit 1
fi

log "OK DOMO operacional: API, n8n, workflows e Funnel."
