#!/usr/bin/env sh
set -eu

project_directory="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
backup_root="${DOMO_BACKUP_DIRECTORY:-$HOME/domo-platform-backups/n8n}"
timestamp="$(date +%Y%m%d-%H%M%S)"
destination="$backup_root/$timestamp"

umask 077
mkdir -p "$destination"
cd "$project_directory"

docker compose exec -T n8n \
  n8n export:workflow --all --output=/tmp/domo-workflows.json

docker cp \
  domo-n8n:/tmp/domo-workflows.json \
  "$destination/workflows.json"

docker compose exec -T postgres sh -lc '
  pg_dump \
    --format=custom \
    --no-owner \
    --username="$POSTGRES_USER" \
    "$POSTGRES_DB"
' > "$destination/n8n-postgres.dump"

cp compose.yaml "$destination/compose.yaml"
cp compose.override.yaml "$destination/compose.override.yaml"
cp .env.example "$destination/.env.example"

sha256sum \
  "$destination/workflows.json" \
  "$destination/n8n-postgres.dump" \
  "$destination/compose.yaml" \
  "$destination/compose.override.yaml" \
  "$destination/.env.example" \
  > "$destination/SHA256SUMS"

chmod 600 "$destination"/*

printf '%s\n' \
  "Backup local concluído." \
  "Diretório: $destination" \
  "Arquivos: workflows.json, n8n-postgres.dump, Compose sem segredos e SHA256SUMS"
