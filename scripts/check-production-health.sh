#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FAILED=0

ok() {
  printf 'OK   %s\n' "$1"
}

fail() {
  printf 'FAIL %s\n' "$1" >&2
  FAILED=1
}

section() {
  printf '\n=== %s ===\n' "$1"
}

read_env_value() {
  local key="$1"

  sed -n "s/^${key}=//p" .env \
    | tail -1 \
    | tr -d '\r' \
    | sed 's/^"//;s/"$//'
}

check_http() {
  local name="$1"
  local url="$2"

  if curl \
    --silent \
    --show-error \
    --fail \
    --max-time 10 \
    "$url" \
    >/dev/null
  then
    ok "$name"
  else
    fail "$name"
  fi
}

section "DOMO PRODUCTION HEALTH"

check_http \
  "API /health" \
  "http://127.0.0.1:3001/health"

check_http \
  "n8n /healthz" \
  "http://127.0.0.1:5678/healthz"

API_KEY="$(read_env_value EVOLUTION_API_KEY)"

if [ -z "$API_KEY" ]; then
  fail "EVOLUTION_API_KEY não encontrada"
else
  ok "EVOLUTION_API_KEY disponível"
fi

section "EVOLUTION INSTANCES"

if [ -n "$API_KEY" ]; then
  INSTANCES="$(
    curl \
      --silent \
      --show-error \
      --fail \
      --max-time 10 \
      -H "apikey: $API_KEY" \
      http://127.0.0.1:8080/instance/fetchInstances \
      2>/dev/null
  )"

  CURL_EXIT=$?

  if [ "$CURL_EXIT" -ne 0 ] || [ -z "$INSTANCES" ]; then
    fail "não foi possível consultar instâncias Evolution"
  else
    RESULT="$(
      INSTANCES_JSON="$INSTANCES" node <<'NODE'
const raw = process.env.INSTANCES_JSON ?? '[]';

let data;

try {
  data = JSON.parse(raw);
} catch {
  console.error('INVALID_JSON');
  process.exit(2);
}

const expected = [
  'domo-assistente',
  'domo-atendimento',
];

let failed = false;

for (const name of expected) {
  const instance = data.find(
    item => item?.name === name,
  );

  if (!instance) {
    console.log(`FAIL ${name}: não encontrada`);
    failed = true;
    continue;
  }

  const status =
    String(instance.connectionStatus ?? '');

  if (status === 'open') {
    console.log(`OK   ${name}: open`);
  } else {
    console.log(
      `FAIL ${name}: status=${status || 'desconhecido'}`
    );

    failed = true;
  }
}

process.exit(failed ? 1 : 0);
NODE
    )"

    NODE_EXIT=$?

    printf '%s\n' "$RESULT"

    if [ "$NODE_EXIT" -ne 0 ]; then
      FAILED=1
    fi
  fi
fi

section "EVOLUTION WEBHOOKS"

check_evolution_webhook() {
  local instance="$1"
  local expected_url="$2"

  local response

  response="$(
    curl \
      --silent \
      --show-error \
      --fail \
      --max-time 10 \
      -H "apikey: $API_KEY" \
      "http://127.0.0.1:8080/webhook/find/$instance" \
      2>/dev/null
  )"

  if [ $? -ne 0 ] || [ -z "$response" ]; then
    fail "$instance: não foi possível consultar webhook"
    return
  fi

  RESULT="$(
    WEBHOOK_JSON="$response" \
    EXPECTED_URL="$expected_url" \
    node <<'NODE'
let data;

try {
  data = JSON.parse(
    process.env.WEBHOOK_JSON ?? '{}'
  );
} catch {
  console.error('JSON inválido');
  process.exit(2);
}

const expected =
  process.env.EXPECTED_URL ?? '';

const events =
  Array.isArray(data.events)
    ? data.events
    : [];

const valid =
  data.enabled === true &&
  data.url === expected &&
  events.includes('MESSAGES_UPSERT');

if (valid) {
  console.log(
    `OK   ${data.url} [MESSAGES_UPSERT]`
  );
  process.exit(0);
}

console.log(
  `FAIL webhook inválido: enabled=${data.enabled} url=${data.url ?? ''}`
);

process.exit(1);
NODE
  )"

  NODE_EXIT=$?

  printf '%s\n' "$RESULT"

  if [ "$NODE_EXIT" -ne 0 ]; then
    FAILED=1
  fi
}

if [ -n "$API_KEY" ]; then
  check_evolution_webhook \
    "domo-assistente" \
    "http://n8n:5678/webhook/domo-whatsapp-inbound"

  check_evolution_webhook \
    "domo-atendimento" \
    "http://n8n:5678/webhook/domo-atendimento-inbound"
fi

section "N8N WEBHOOK REGISTRATION"

POSTGRES_USER_VALUE="$(
  read_env_value POSTGRES_USER
)"

POSTGRES_DB_VALUE="$(
  read_env_value POSTGRES_DB
)"

if \
  [ -z "$POSTGRES_USER_VALUE" ] ||
  [ -z "$POSTGRES_DB_VALUE" ]
then
  fail "variáveis PostgreSQL não encontradas"
else
  WEBHOOK_ROWS="$(
    docker compose exec -T postgres \
      psql \
      -U "$POSTGRES_USER_VALUE" \
      -d "$POSTGRES_DB_VALUE" \
      -At \
      -c "
        SELECT
          \"workflowId\" || '|' ||
          \"webhookPath\" || '|' ||
          method
        FROM webhook_entity
        WHERE \"workflowId\" IN (
          'gseL5lW5viEgNEWQ',
          'VAhyWtgWl6kzU8gL'
        )
        ORDER BY \"workflowId\";
      " \
      2>/dev/null
  )"

  if grep -Fxq \
    'gseL5lW5viEgNEWQ|domo-whatsapp-inbound|POST' \
    <<< "$WEBHOOK_ROWS"
  then
    ok "workflow 10 webhook registrado"
  else
    fail "workflow 10 webhook ausente/incorreto"
  fi

  if grep -Fxq \
    'VAhyWtgWl6kzU8gL|domo-atendimento-inbound|POST' \
    <<< "$WEBHOOK_ROWS"
  then
    ok "workflow 20 webhook registrado"
  else
    fail "workflow 20 webhook ausente/incorreto"
  fi
fi

section "RESULTADO"

if [ "$FAILED" -eq 0 ]; then
  echo "DOMO HEALTH: OK"
  exit 0
fi

echo "DOMO HEALTH: FAIL"
exit 1
