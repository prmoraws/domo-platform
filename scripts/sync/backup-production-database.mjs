import {
  execFileSync,
} from 'node:child_process';

import {
  mkdirSync,
} from 'node:fs';

import {
  homedir,
} from 'node:os';

import {
  join,
} from 'node:path';

const sshHost = 'domo-production';
const productionDatabase = 'domo_moraw';

const now = new Date();
const date = now.toISOString().slice(0, 10);
const timestamp = now
  .toISOString()
  .replaceAll(':', '')
  .replaceAll('-', '')
  .replace(/\.\d{3}Z$/, 'Z');

const fileName =
  `domo-moraw-production-${timestamp}.sql.gz`;

const remoteDirectory =
  `.cache/domo-sync/${timestamp}`;

const localDirectory = join(
  homedir(),
  'domo-data',
  'backups',
  'production',
  date,
);

const run = (
  program,
  argumentsList,
  options = {},
) => {
  console.log(`\nExecutando: ${program}`);

  execFileSync(
    program,
    argumentsList,
    {
      stdio: 'inherit',
      ...options,
    },
  );
};

const remoteBackupScript = `
set -euo pipefail

remote_directory="$1"
file_name="$2"
database_name="$3"

umask 077

mkdir -p "$remote_directory"

mariadb-dump \\
  --defaults-extra-file="$HOME/.config/domo/production-db.cnf" \\
  --single-transaction \\
  --quick \\
  --events \\
  --triggers \\
  --hex-blob \\
  --skip-lock-tables \\
  --default-character-set=utf8mb4 \\
  "$database_name" |
gzip -9 > "$remote_directory/$file_name"

gzip -t "$remote_directory/$file_name"

(
  cd "$remote_directory"
  sha256sum "$file_name" > "$file_name.sha256"
)

printf 'Backup remoto criado e validado\\n'
`;

try {
  console.log('Iniciando backup da produção DOMO');
  console.log(`Banco: ${productionDatabase}`);
  console.log(`Destino local: ${localDirectory}`);

  mkdirSync(
    localDirectory,
    {
      recursive: true,
      mode: 0o700,
    },
  );

  execFileSync(
    'ssh',
    [
      sshHost,
      'bash',
      '-s',
      '--',
      remoteDirectory,
      fileName,
      productionDatabase,
    ],
    {
      input: remoteBackupScript,
      stdio: [
        'pipe',
        'inherit',
        'inherit',
      ],
    },
  );

  run(
    'scp',
    [
      `${sshHost}:${remoteDirectory}/${fileName}`,
      `${sshHost}:${remoteDirectory}/${fileName}.sha256`,
      localDirectory,
    ],
  );

  run(
    'gzip',
    [
      '-t',
      join(localDirectory, fileName),
    ],
  );

  run(
    'sha256sum',
    [
      '-c',
      `${fileName}.sha256`,
    ],
    {
      cwd: localDirectory,
    },
  );

  console.log('\nSINCRONIZAÇÃO DE BACKUP CONCLUÍDA');
  console.log(
    `Arquivo: ${join(localDirectory, fileName)}`,
  );
  console.log(
    'A réplica MariaDB ainda não foi modificada.',
  );
} catch (error) {
  console.error('\nERRO: backup não concluído');

  if (error instanceof Error) {
    console.error(error.message);
  }

  console.error(
    'Nenhum banco local foi substituído.',
  );

  process.exit(1);
}