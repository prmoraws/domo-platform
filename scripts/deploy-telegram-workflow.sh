#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW_FILE="$ROOT_DIR/infrastructure/n8n/workflows/30-atendimento-telegram.json"
WORKFLOW_NAME="DOMO - 30 - Atendimento Telegram"
TMP_CONTAINER_FILE="/tmp/domo-30-atendimento-telegram.json"
TMP_EXPORT_FILE="/tmp/domo-30-atendimento-telegram-export.json"

usage() {
  cat <<'EOF'
Uso:
  ./scripts/deploy-telegram-workflow.sh import
  ./scripts/deploy-telegram-workflow.sh verify
  ./scripts/deploy-telegram-workflow.sh publish

Fluxo recomendado:
  1. import
  2. configurar no n8n a credencial Telegram API nos nós
     "Telegram Trigger" e "Responder Telegram"
  3. verify
  4. publish

O script nunca recebe nem grava o token do BotFather.
EOF
}

require_file() {
  if [[ ! -f "$WORKFLOW_FILE" ]]; then
    echo "ERRO: workflow não encontrado: $WORKFLOW_FILE" >&2
    exit 1
  fi
}

workflow_id() {
  docker compose exec -T n8n n8n list:workflow 2>/dev/null \
    | awk -F'|' -v name="$WORKFLOW_NAME" '$2 == name { print $1; exit }'
}

check_health() {
  for _ in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:5678/healthz >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "ERRO: n8n não ficou saudável." >&2
  return 1
}

cmd_import() {
  require_file

  echo '=== VALIDAR JSON VERSIONADO ==='
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const w = JSON.parse(fs.readFileSync(file, "utf8"));
    if (w.name !== "DOMO - 30 - Atendimento Telegram") {
      throw new Error(`Nome inesperado: ${w.name}`);
    }
    if (w.active !== false) {
      throw new Error("O workflow versionado deve permanecer active=false");
    }
    const names = new Set((w.nodes ?? []).map(n => n.name));
    for (const required of [
      "Telegram Trigger",
      "Preparar atendimento",
      "Responder?",
      "Consultar atendimento",
      "Registrar contexto",
      "Preparar resposta",
      "Responder Telegram",
    ]) {
      if (!names.has(required)) {
        throw new Error(`Nó obrigatório ausente: ${required}`);
      }
    }
    console.log("OK: workflow 30 válido para importação.");
  ' "$WORKFLOW_FILE"

  echo
  echo '=== COPIAR PARA O N8N ==='
  docker compose cp "$WORKFLOW_FILE" "n8n:$TMP_CONTAINER_FILE"

  echo
  echo '=== IMPORTAR ==='
  docker compose exec -T n8n \
    n8n import:workflow \
    --input="$TMP_CONTAINER_FILE"

  echo
  echo '=== LOCALIZAR WORKFLOW ==='
  local id
  id="$(workflow_id)"

  if [[ -z "$id" ]]; then
    echo "ERRO: workflow importado não foi localizado." >&2
    exit 1
  fi

  echo "OK: $WORKFLOW_NAME"
  echo "ID: $id"
  echo
  echo 'PRÓXIMO PASSO:'
  echo 'Abra o workflow no n8n e associe a credencial Telegram API aos nós:'
  echo '  - Telegram Trigger'
  echo '  - Responder Telegram'
  echo 'Depois execute:'
  echo '  ./scripts/deploy-telegram-workflow.sh verify'
}

cmd_verify() {
  local id
  id="$(workflow_id)"

  if [[ -z "$id" ]]; then
    echo "ERRO: $WORKFLOW_NAME não encontrado no n8n." >&2
    exit 1
  fi

  echo "=== EXPORTAR WORKFLOW $id ==="
  docker compose exec -T n8n \
    n8n export:workflow \
    --id="$id" \
    --output="$TMP_EXPORT_FILE"

  echo
  echo '=== VALIDAR CREDENCIAIS E ESTRUTURA ==='
  docker compose exec -T n8n node - "$TMP_EXPORT_FILE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const w = Array.isArray(raw) ? raw[0] : raw;

const node = name => (w.nodes ?? []).find(n => n.name === name);
const trigger = node('Telegram Trigger');
const responder = node('Responder Telegram');
const query = node('Consultar atendimento');

if (!trigger || !responder || !query) {
  throw new Error('Estrutura obrigatória do workflow 30 está incompleta.');
}

const triggerCredential = trigger.credentials?.telegramApi;
const responderCredential = responder.credentials?.telegramApi;

if (!triggerCredential) {
  throw new Error('Telegram Trigger ainda não possui credencial Telegram API.');
}

if (!responderCredential) {
  throw new Error('Responder Telegram ainda não possui credencial Telegram API.');
}

if (
  triggerCredential.id &&
  responderCredential.id &&
  triggerCredential.id !== responderCredential.id
) {
  throw new Error('Trigger e resposta usam credenciais Telegram diferentes.');
}

if (query.parameters?.url !== 'http://api:3001/internal/customer-service/query') {
  throw new Error('Workflow 30 não aponta para o atendimento público esperado.');
}

const serialized = JSON.stringify(w).toLowerCase();
for (const forbidden of [
  '/internal/assistant/query',
  'mariadb',
  'mysql',
  'execute_readonly',
]) {
  if (serialized.includes(forbidden)) {
    throw new Error(`Acesso proibido detectado: ${forbidden}`);
  }
}

console.log('OK: credencial Telegram presente nos dois nós.');
console.log('OK: workflow 30 usa somente o atendimento público.');
console.log(`ID: ${w.id ?? '[não informado]'}`);
console.log(`active: ${w.active === true}`);
NODE

  echo
  echo 'VALIDAÇÃO CONCLUÍDA.'
  echo 'Faça agora um teste manual pelo n8n antes de publicar.'
}

cmd_publish() {
  local id
  id="$(workflow_id)"

  if [[ -z "$id" ]]; then
    echo "ERRO: $WORKFLOW_NAME não encontrado no n8n." >&2
    exit 1
  fi

  echo '=== PRÉ-VALIDAÇÃO ==='
  cmd_verify

  echo
  echo "=== PUBLICAR WORKFLOW $id ==="
  docker compose exec -T n8n \
    n8n publish:workflow \
    --id="$id"

  echo
  echo '=== REINICIAR SOMENTE N8N ==='
  docker compose restart n8n
  check_health

  echo
  echo '=== RESULTADO ==='
  echo 'n8n saudável.'
  echo "Workflow publicado: $WORKFLOW_NAME"
  echo "ID: $id"
  echo
  echo 'Faça os testes reais do Telegram descritos em:'
  echo '  docs/architecture/ATENDIMENTO-TELEGRAM.md'
}

cd "$ROOT_DIR"

case "${1:-}" in
  import)
    cmd_import
    ;;
  verify)
    cmd_verify
    ;;
  publish)
    cmd_publish
    ;;
  *)
    usage
    exit 2
    ;;
esac
