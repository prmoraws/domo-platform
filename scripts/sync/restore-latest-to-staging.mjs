import {
  spawnSync,
} from 'node:child_process';

import {
  readdirSync,
  statSync,
} from 'node:fs';

import {
  homedir,
} from 'node:os';

import {
  join,
  resolve,
} from 'node:path';

process.umask(0o077);

const projectDirectory = resolve(
  import.meta.dirname,
  '..',
  '..',
);

const backupDirectory = join(
  homedir(),
  'domo-data',
  'backups',
  'production',
);


const findBackupFiles = (directory) => {
  const files = [];

  for (const entry of readdirSync(
    directory,
    {
      withFileTypes: true,
    },
  )) {
    const fullPath = join(
      directory,
      entry.name,
    );

    if (entry.isDirectory()) {
      files.push(...findBackupFiles(fullPath));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith('.sql.gz')
    ) {
      files.push(fullPath);
    }
  }

  return files;
};

const run = (
  program,
  argumentsList,
  options = {},
) => {
  console.log(`Executando: ${program}`);

  const result = spawnSync(
    program,
    argumentsList,
    {
      cwd: projectDirectory,
      encoding: 'utf8',
      ...options,
    },
  );

  if (result.status !== 0) {
    if (result.stdout) {
      console.error(result.stdout);
    }

    if (result.stderr) {
      console.error(result.stderr);
    }

    throw new Error(
      `${program} terminou com código ${result.status}`,
    );
  }

  return result;
};

const getReplicaConfiguration = () => {
  const result = run(
    'docker',
    [
      'compose',
      'config',
      '--format',
      'json',
    ],
    {
      stdio: [
        'ignore',
        'pipe',
        'inherit',
      ],
    },
  );

  const compose = JSON.parse(
    result.stdout,
  );

  const activeDatabase =
    compose.services?.api?.environment
      ?.MYSQL_DATABASE;

  const blueDatabase =
    compose.services?.mariadb?.environment
      ?.REPLICA_BLUE_DATABASE;

  const greenDatabase =
    compose.services?.mariadb?.environment
      ?.REPLICA_GREEN_DATABASE;

  const databaseNames = [
    activeDatabase,
    blueDatabase,
    greenDatabase,
  ];

  for (const databaseName of databaseNames) {
    if (
      typeof databaseName !== 'string' ||
      !/^[a-zA-Z0-9_]+$/.test(databaseName)
    ) {
      throw new Error(
        'Configuração azul/verde inválida',
      );
    }
  }

  if (blueDatabase === greenDatabase) {
    throw new Error(
      'Os bancos azul e verde não podem ser iguais',
    );
  }

  if (
    activeDatabase !== blueDatabase &&
    activeDatabase !== greenDatabase
  ) {
    throw new Error(
      'MYSQL_DATABASE não corresponde a um slot azul/verde',
    );
  }

  const inactiveDatabase =
    activeDatabase === blueDatabase
      ? greenDatabase
      : blueDatabase;

  return {
    activeDatabase,
    inactiveDatabase,
  };
};

try {
  const {
    activeDatabase,
    inactiveDatabase,
  } = getReplicaConfiguration();

  const backupFiles = findBackupFiles(
    backupDirectory,
  );

  if (backupFiles.length === 0) {
    throw new Error(
      'Nenhum backup de produção foi encontrado',
    );
  }

  backupFiles.sort(
    (first, second) =>
      statSync(second).mtimeMs -
      statSync(first).mtimeMs,
  );

  const latestBackup = backupFiles[0];

  if (!latestBackup) {
    throw new Error(
      'Não foi possível selecionar o backup',
    );
  }

  console.log('RESTAURAÇÃO SEGURA NO SLOT INATIVO');
  console.log(`Backup: ${latestBackup}`);
  console.log(`Destino: ${inactiveDatabase}`);

  run(
    'gzip',
    [
      '-t',
      latestBackup,
    ],
    {
      stdio: 'inherit',
    },
  );

  const prepareSql = `
DROP DATABASE IF EXISTS \`${inactiveDatabase}\`;

CREATE DATABASE \`${inactiveDatabase}\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
`;

  run(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'mariadb',
      'sh',
      '-c',
      'exec mariadb --user=root --password="$MYSQL_ROOT_PASSWORD"',
    ],
    {
      input: prepareSql,
      stdio: [
        'pipe',
        'inherit',
        'inherit',
      ],
    },
  );

  const importCommand = `
set -o pipefail

gzip -cd -- "$1" |
docker compose exec -T mariadb \
  sh -c \
  'exec mariadb \
    --user=root \
    --password="$MYSQL_ROOT_PASSWORD" \
    ${inactiveDatabase}'
`;

  run(
    'bash',
    [
      '-c',
      importCommand,
      'domo-restore',
      latestBackup,
    ],
    {
      stdio: 'inherit',
    },
  );

  const validationSql = `
SELECT COUNT(*)
FROM information_schema.tables
WHERE table_schema = '${inactiveDatabase}'
  AND table_type = 'BASE TABLE';
`;

  const validation = run(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'mariadb',
      'sh',
      '-c',
      'exec mariadb --user=root --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names',
    ],
    {
      input: validationSql,
      stdio: [
        'pipe',
        'pipe',
        'inherit',
      ],
    },
  );

  const tableCount = Number(
    validation.stdout.trim(),
  );

  if (
    !Number.isInteger(tableCount) ||
    tableCount < 1
  ) {
    throw new Error(
      'O staging foi criado sem tabelas válidas',
    );
  }

  console.log('\nSLOT INATIVO RESTAURADO COM SUCESSO');
  console.log(`Tabelas encontradas: ${tableCount}`);
  console.log(`Slot atualizado: ${inactiveDatabase}`);
  console.log(
    `A réplica ativa ${activeDatabase} não foi modificada.`,
  );
} catch (error) {
  console.error('\nERRO NA RESTAURAÇÃO DO STAGING');

  if (error instanceof Error) {
    console.error(error.message);
  }

  console.error(
    'A réplica ativa domo_replica permaneceu intacta.',
  );

  process.exit(1);
}