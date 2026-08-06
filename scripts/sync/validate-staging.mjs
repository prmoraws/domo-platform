import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const projectDirectory = resolve(
  import.meta.dirname,
  '..',
  '..',
);

const getReplicaConfiguration = () => {
  const result = spawnSync(
    'docker',
    [
      'compose',
      'config',
      '--format',
      'json',
    ],
    {
      cwd: projectDirectory,
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    if (result.stderr) {
      console.error(result.stderr);
    }

    throw new Error(
      'Não foi possível ler a configuração do Compose',
    );
  }

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

  for (
    const databaseName of [
      activeDatabase,
      blueDatabase,
      greenDatabase,
    ]
  ) {
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
      'O banco ativo não corresponde aos slots configurados',
    );
  }

  return {
    activeDatabase,
    inactiveDatabase:
      activeDatabase === blueDatabase
        ? greenDatabase
        : blueDatabase,
  };
};

const runMariaDb = (sql) => {
  const result = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'mariadb',
      'sh',
      '-c',
      [
        'exec mariadb',
        '--user=root',
        '--password="$MYSQL_ROOT_PASSWORD"',
        '--batch',
        '--skip-column-names',
        '--raw',
      ].join(' '),
    ],
    {
      cwd: projectDirectory,
      encoding: 'utf8',
      input: sql,
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
      `A consulta terminou com código ${result.status}`,
    );
  }

  return result.stdout.trim();
};

const getLines = (sql) => {
  const output = runMariaDb(sql);

  if (!output) {
    return [];
  }

  return output.split('\n');
};

const quoteIdentifier = (identifier) => {
  return `\`${identifier.replaceAll('`', '``')}\``;
};

const compareLists = (
  description,
  activeItems,
  stagingItems,
) => {
  const activeSet = new Set(activeItems);
  const stagingSet = new Set(stagingItems);

  const onlyActive = activeItems.filter(
    (item) => !stagingSet.has(item),
  );

  const onlyStaging = stagingItems.filter(
    (item) => !activeSet.has(item),
  );

  if (
    onlyActive.length === 0 &&
    onlyStaging.length === 0
  ) {
    console.log(
      `OK: ${description} são iguais`,
    );

    return true;
  }

  console.error(
    `DIFERENÇA ENCONTRADA: ${description}`,
  );

  if (onlyActive.length > 0) {
    console.error('Somente na réplica ativa:');

    for (const item of onlyActive) {
      console.error(`- ${item}`);
    }
  }

  if (onlyStaging.length > 0) {
    console.error('Somente no staging:');

    for (const item of onlyStaging) {
      console.error(`- ${item}`);
    }
  }

  return false;
};

const getTables = (database) => {
  return getLines(`
SELECT table_name
FROM information_schema.tables
WHERE table_schema = '${database}'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
`);
};

const getColumnDefinitions = (database) => {
  return getLines(`
SELECT CONCAT_WS(
  '|',
  table_name,
  ordinal_position,
  column_name,
  column_type,
  is_nullable,
  COALESCE(column_default, '<NULL>'),
  extra,
  COALESCE(character_set_name, '<NULL>'),
  COALESCE(collation_name, '<NULL>')
)
FROM information_schema.columns
WHERE table_schema = '${database}'
ORDER BY table_name, ordinal_position;
`);
};

const getIndexDefinitions = (database) => {
  return getLines(`
SELECT CONCAT_WS(
  '|',
  table_name,
  index_name,
  non_unique,
  seq_in_index,
  column_name,
  COALESCE(sub_part, '<NULL>'),
  index_type
)
FROM information_schema.statistics
WHERE table_schema = '${database}'
ORDER BY
  table_name,
  index_name,
  seq_in_index;
`);
};

const getExactCounts = (
  database,
  tables,
) => {
  if (tables.length === 0) {
    return new Map();
  }

  const statements = tables.map((table) => {
    const quotedDatabase =
      quoteIdentifier(database);

    const quotedTable =
      quoteIdentifier(table);

    const tableLiteral =
      table.replaceAll("'", "''");

    return [
      `SELECT '${tableLiteral}' AS tabela,`,
      'COUNT(*) AS quantidade',
      `FROM ${quotedDatabase}.${quotedTable}`,
    ].join(' ');
  });

  const lines = getLines(
    `${statements.join('\nUNION ALL\n')};`,
  );

  const counts = new Map();

  for (const line of lines) {
    const [table, quantityText] =
      line.split('\t');

    const quantity = Number(quantityText);

    if (
      !table ||
      !Number.isSafeInteger(quantity)
    ) {
      throw new Error(
        `Contagem inválida recebida: ${line}`,
      );
    }

    counts.set(table, quantity);
  }

  return counts;
};

const compareCounts = (
  tables,
  activeCounts,
  stagingCounts,
) => {
  const differences = [];

  let activeTotal = 0;
  let stagingTotal = 0;

  for (const table of tables) {
    const activeCount =
      activeCounts.get(table);

    const stagingCount =
      stagingCounts.get(table);

    if (
      activeCount === undefined ||
      stagingCount === undefined
    ) {
      differences.push({
        table,
        activeCount,
        stagingCount,
      });

      continue;
    }

    activeTotal += activeCount;
    stagingTotal += stagingCount;

    if (activeCount !== stagingCount) {
      differences.push({
        table,
        activeCount,
        stagingCount,
      });
    }
  }

  console.log(
    `Registros na réplica ativa: ${activeTotal}`,
  );

  console.log(
    `Registros no staging: ${stagingTotal}`,
  );

  if (differences.length === 0) {
    console.log(
      'OK: quantidades exatas são iguais',
    );

    return true;
  }

  console.error(
    'DIFERENÇAS NAS QUANTIDADES:',
  );

  for (const difference of differences) {
    console.error(
      [
        `- ${difference.table}:`,
        `ativa=${difference.activeCount ?? 'ausente'},`,
        `staging=${difference.stagingCount ?? 'ausente'}`,
      ].join(' '),
    );
  }

  return false;
};

try {
  const {
    activeDatabase,
    inactiveDatabase,
  } = getReplicaConfiguration();

  console.log(
    'VALIDAÇÃO DA RÉPLICA DOMO',
  );

  console.log(
    `Ativa: ${activeDatabase}`,
  );

  console.log(
    `Inativo: ${inactiveDatabase}\n`,
  );

  const activeTables =
    getTables(activeDatabase);

  const stagingTables =
    getTables(inactiveDatabase);

  if (
    activeTables.length === 0 ||
    stagingTables.length === 0
  ) {
    throw new Error(
      'Um dos bancos não possui tabelas',
    );
  }

  console.log(
    `Tabelas na réplica ativa: ${activeTables.length}`,
  );

  console.log(
    `Tabelas no staging: ${stagingTables.length}`,
  );

  const tablesAreEqual = compareLists(
    'as listas de tabelas',
    activeTables,
    stagingTables,
  );

  const columnsAreEqual = compareLists(
    'as definições das colunas',
    getColumnDefinitions(activeDatabase),
    getColumnDefinitions(inactiveDatabase),
  );

  const indexesAreEqual = compareLists(
    'as definições dos índices',
    getIndexDefinitions(activeDatabase),
    getIndexDefinitions(inactiveDatabase),
  );

  let countsAreEqual = false;

  if (tablesAreEqual) {
    countsAreEqual = compareCounts(
      activeTables,
      getExactCounts(
        activeDatabase,
        activeTables,
      ),
      getExactCounts(
        inactiveDatabase,
        stagingTables,
      ),
    );
  } else {
    console.error(
      'Contagem não executada porque as tabelas diferem',
    );
  }

  const validationPassed =
    tablesAreEqual &&
    columnsAreEqual &&
    indexesAreEqual &&
    countsAreEqual;

  if (!validationPassed) {
    throw new Error(
      'O staging não corresponde à réplica ativa',
    );
  }

  console.log(
    '\nVALIDAÇÃO CONCLUÍDA COM SUCESSO',
  );

  console.log(
    'Nenhum banco foi modificado.',
  );
} catch (error) {
  console.error(
    '\nVALIDAÇÃO REPROVADA',
  );

  if (error instanceof Error) {
    console.error(error.message);
  }

  console.error(
    'Nenhum banco foi modificado.',
  );

  process.exit(1);
}