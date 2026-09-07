#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW_FILE="$ROOT_DIR/infrastructure/n8n/workflows/30-atendimento-telegram.json"
WORKFLOW_NAME="DOMO - 30 - Atendimento Telegram"
WORKFLOW_ID="DOMO30TELEGRAM01"
TMP_HOST_FILE="/tmp/domo-30-atendimento-telegram-import.json"
TMP_CONTAINER_FILE="/tmp/domo-30-atendimento-telegram-import.json"
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
  4. testar manualmente
  5. publish

O script nunca recebe nem grava o token do BotFather.
O workflow usa o ID estável DOMO30TELEGRAM01.
EOF
}

require_file() {
  [[ -f "$WORKFLOW_FILE" ]] || {
    echo "ERRO: workflow não encontrado: $WORKFLOW_FILE" >&2
    exit 1
  }
}

check_health() {
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:5678/healthz >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "ERRO: n8n não ficou saudável." >&2
  return 1
}

workflow_exists() {
  docker compose exec -T n8n n8n list:workflow 2>/dev/null \
    | awk -F'|' -v id="$WORKFLOW_ID" -v name="$WORKFLOW_NAME" \
      '$1 == id && $2 == name { found=1 } END { exit found ? 0 : 1 }'
}

prepare_import_file() {
  require_file
  node - "$WORKFLOW_FILE" "$TMP_HOST_FILE" "$WORKFLOW_ID" <<'NODE'
const fs = require('fs');
const [source, target, workflowId] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(source, 'utf8'));
const workflow = Array.isArray(raw) ? raw[0] : raw;

if (workflow.name !== 'DOMO - 30 - Atendimento Telegram') {
  throw new Error(`Nome inesperado: ${workflow.name}`);
}

const names = new Set((workflow.nodes ?? []).map(node => node.name));
for (const required of [
  'Telegram Trigger',
  'Preparar atendimento',
  'Responder?',
  'Consultar atendimento',
  'Registrar contexto',
  'Preparar resposta',
  'Responder Telegram',
]) {
  if (!names.has(required)) {
    throw new Error(`Nó obrigatório ausente: ${required}`);
  }
}

workflow.id = workflowId;
workflow.active = false;
fs.writeFileSync(target, JSON.stringify(workflow, null, 2) + '\n');
console.log(`OK: import preparado com ID ${workflowId}.`);
NODE
}

cmd_import() {
  echo '=== PREPARAR WORKFLOW ==='
  prepare_import_file

  echo
  echo '=== COPIAR PARA O N8N ==='
  docker compose cp "$TMP_HOST_FILE" "n8n:$TMP_CONTAINER_FILE"

  echo
  echo '=== IMPORTAR DESATIVADO ==='
  docker compose exec -T n8n \
    n8n import:workflow \
    --input="$TMP_CONTAINER_FILE"

  echo
  if ! workflow_exists; then
    echo "ERRO: workflow $WORKFLOW_ID não foi localizado após importação." >&2
    exit 1
  fi

  echo "OK: $WORKFLOW_NAME"
  echo "ID: $WORKFLOW_ID"
  echo
  echo 'PRÓXIMO PASSO:'
  echo 'Associe a mesma credencial Telegram API aos nós:'
  echo '  - Telegram Trigger'
  echo '  - Responder Telegram'
  echo 'Depois rode: ./scripts/deploy-telegram-workflow.sh verify'
}

cmd_verify() {
  if ! workflow_exists; then
    echo "ERRO: $WORKFLOW_NAME ($WORKFLOW_ID) não encontrado no n8n." >&2
    exit 1
  fi

  echo "=== EXPORTAR WORKFLOW $WORKFLOW_ID ==="
  docker compose exec -T n8n \
    n8n export:workflow \
    --id="$WORKFLOW_ID" \
    --output="$TMP_EXPORT_FILE"

  echo
  echo '=== VALIDAR CREDENCIAIS E ESTRUTURA ==='
  docker compose exec -T n8n node - "$TMP_EXPORT_FILE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const w = Array.isArray(raw) ? raw[0] : raw;

if (w.id !== 'DOMO30TELEGRAM01') {
  throw new Error(`ID inesperado: ${w.id}`);
}

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
  triggerCredential.id && responderCredential.id &&
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
console.log(`ID: ${w.id}`);
console.log(`active: ${w.active === true}`);
NODE

  echo
  echo 'VALIDAÇÃO CONCLUÍDA.'
}

cmd_publish() {
  echo '=== PRÉ-VALIDAÇÃO ==='
  cmd_verify

  echo
  echo "=== PUBLICAR WORKFLOW $WORKFLOW_ID ==="
  docker compose exec -T n8n \
    n8n publish:workflow \
    --id="$WORKFLOW_ID"

  echo
  echo '=== GARANTIR ATIVAÇÃO ==='
  docker compose exec -T n8n \
    n8n update:workflow \
    --id="$WORKFLOW_ID" \
    --active=true

  echo
  echo '=== REINICIAR SOMENTE N8N ==='
  docker compose restart n8n
  check_health

  echo
  echo '=== RESULTADO ==='
  echo 'n8n saudável.'
  echo "Workflow publicado e ativado: $WORKFLOW_NAME"
  echo "ID: $WORKFLOW_ID"
}

cd "$ROOT_DIR"
case "${1:-}" in
  import) cmd_import ;;
  verify) cmd_verify ;;
  publish) cmd_publish ;;
  *) usage; exit 2 ;;
esac
