import {
  spawnSync,
} from 'node:child_process';

import {
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

import {
  resolve,
} from 'node:path';

const projectDirectory = resolve(
  import.meta.dirname,
  '..',
  '..',
);

const envPath = resolve(
  projectDirectory,
  '.env',
);

const temporaryEnvPath = resolve(
  projectDirectory,
  '.env.domo-promotion.tmp',
);

const originalEnv = readFileSync(
  envPath,
  'utf8',
);

const envMode =
  statSync(envPath).mode & 0o777;

const getEnvValue = (name) => {
  const prefix = `${name}=`;

  const line = originalEnv
    .split(/\r?\n/)
    .find((item) => item.startsWith(prefix));

  if (!line) {
    throw new Error(
      `Variável ausente no .env: ${name}`,
    );
  }

  return line
    .slice(prefix.length)
    .trim()
    .replace(/^['"]|['"]$/g, '');
};

const activeDatabase =
  getEnvValue('MYSQL_DATABASE');

const blueDatabase =
  getEnvValue('REPLICA_BLUE_DATABASE');

const greenDatabase =
  getEnvValue('REPLICA_GREEN_DATABASE');

const internalToken =
  getEnvValue('API_INTERNAL_TOKEN');

const apiPort = Number(
  getEnvValue('API_PORT'),
);

if (
  blueDatabase === greenDatabase ||
  (
    activeDatabase !== blueDatabase &&
    activeDatabase !== greenDatabase
  )
) {
  throw new Error(
    'Configuração azul/verde inválida',
  );
}

if (
  !Number.isInteger(apiPort) ||
  apiPort < 1 ||
  apiPort > 65535
) {
  throw new Error(
    'API_PORT inválida',
  );
}

const inactiveDatabase =
  activeDatabase === blueDatabase
    ? greenDatabase
    : blueDatabase;

const composeEnvironment = (database) => ({
  ...process.env,
  MYSQL_DATABASE: database,
  REPLICA_BLUE_DATABASE: blueDatabase,
  REPLICA_GREEN_DATABASE: greenDatabase,
});

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
      stdio: 'inherit',
      ...options,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `${program} terminou com código ${result.status}`,
    );
  }
};

const writeEnv = (
  content,
) => {
  writeFileSync(
    temporaryEnvPath,
    content,
    {
      encoding: 'utf8',
      mode: envMode,
    },
  );

  renameSync(
    temporaryEnvPath,
    envPath,
  );
};

const updateActiveDatabase = (
  database,
) => {
  const occurrences =
    originalEnv.match(
      /^MYSQL_DATABASE=.*$/gm,
    ) ?? [];

  if (occurrences.length !== 1) {
    throw new Error(
      'MYSQL_DATABASE precisa aparecer uma vez no .env',
    );
  }

  return originalEnv.replace(
    /^MYSQL_DATABASE=.*$/m,
    `MYSQL_DATABASE=${database}`,
  );
};

const recreateApi = (
  database,
) => {
  run(
    'docker',
    [
      'compose',
      'up',
      '-d',
      '--no-deps',
      '--force-recreate',
      'api',
    ],
    {
      env: composeEnvironment(database),
    },
  );
};

const wait = (milliseconds) =>
  new Promise((resolvePromise) => {
    setTimeout(
      resolvePromise,
      milliseconds,
    );
  });

const verifyApiDatabase = async (
  expectedDatabase,
) => {
  let lastMessage =
    'API ainda não respondeu';

  for (
    let attempt = 1;
    attempt <= 30;
    attempt += 1
  ) {
    try {
      const response = await fetch(
        [
          `http://127.0.0.1:${apiPort}`,
          '/internal/database/status',
        ].join(''),
        {
          headers: {
            Authorization:
              `Bearer ${internalToken}`,
          },
        },
      );

      const body = await response.json();

      if (
        response.ok &&
        body.database?.name ===
          expectedDatabase &&
        body.database?.readOnly === true
      ) {
        return;
      }

      lastMessage =
        `Resposta inesperada: ${JSON.stringify(body)}`;
    } catch (error) {
      lastMessage =
        error instanceof Error
          ? error.message
          : String(error);
    }

    await wait(2000);
  }

  throw new Error(lastMessage);
};

try {
  console.log('PROMOÇÃO AZUL/VERDE DOMO');
  console.log(`Ativo atual: ${activeDatabase}`);
  console.log(`Novo ativo: ${inactiveDatabase}`);

  run(
    process.execPath,
    [
      'scripts/sync/validate-staging.mjs',
    ],
    {
      env: composeEnvironment(
        activeDatabase,
      ),
    },
  );

  console.log(
    'Validação aprovada. Alterando o ponteiro...',
  );

  writeEnv(
    updateActiveDatabase(
      inactiveDatabase,
    ),
  );

  try {
    recreateApi(
      inactiveDatabase,
    );

    await verifyApiDatabase(
      inactiveDatabase,
    );
  } catch (promotionError) {
    console.error(
      'Falha após a troca. Iniciando rollback...',
    );

    writeEnv(originalEnv);

    recreateApi(
      activeDatabase,
    );

    await verifyApiDatabase(
      activeDatabase,
    );

    throw promotionError;
  }

  console.log(
    '\nPROMOÇÃO CONCLUÍDA COM SUCESSO',
  );

  console.log(
    `Banco ativo: ${inactiveDatabase}`,
  );

  console.log(
    `Rollback disponível: ${activeDatabase}`,
  );
} catch (error) {
  if (
    statSync(envPath).isFile() &&
    readFileSync(envPath, 'utf8') !==
      originalEnv
  ) {
    writeEnv(originalEnv);
  }

  try {
    unlinkSync(temporaryEnvPath);
  } catch {
    // O arquivo temporário pode não existir.
  }

  console.error(
    '\nPROMOÇÃO NÃO CONCLUÍDA',
  );

  if (error instanceof Error) {
    console.error(error.message);
  }

  process.exit(1);
}