import {
  createPool,
  type RowDataPacket,
} from 'mysql2/promise';

import {
  validateSelectSql,
} from './safe-sql-validator.js';


const requiredEnvironmentVariable = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variável obrigatória não configurada: ${name}`);
  }

  return value;
};

const mysqlPort = Number(process.env.MYSQL_PORT ?? 3306);

if (
  !Number.isInteger(mysqlPort) ||
  mysqlPort < 1 ||
  mysqlPort > 65535
) {
  throw new Error('MYSQL_PORT precisa ser uma porta válida');
}

const pool = createPool({
  host: requiredEnvironmentVariable('MYSQL_HOST'),
  port: mysqlPort,
  database: requiredEnvironmentVariable('MYSQL_DATABASE'),
  user: requiredEnvironmentVariable('MYSQL_USER'),
  password: requiredEnvironmentVariable('MYSQL_PASSWORD'),
  connectionLimit: 5,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  connectTimeout: 5000,
  multipleStatements: false,
});

interface DatabaseStatusRow extends RowDataPacket {
  databaseName: string;
  databaseUser: string;
  databaseVersion: string;
}

export const getDatabaseStatus = async () => {
  const [rows] = await pool.query<DatabaseStatusRow[]>(`
    SELECT
      DATABASE() AS databaseName,
      CURRENT_USER() AS databaseUser,
      VERSION() AS databaseVersion
  `);

  const status = rows[0];

  if (!status) {
    throw new Error('MySQL não retornou informações da conexão');
  }

  return {
    name: status.databaseName,
    user: status.databaseUser,
    version: status.databaseVersion,
    readOnly: true,
  };
};

interface DatabaseSummaryRow extends RowDataPacket {
  tableCount: number;
}

export const getDatabaseSummary = async () => {
  const [rows] = await pool.query<DatabaseSummaryRow[]>(`
    SELECT COUNT(*) AS tableCount
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_type = 'BASE TABLE'
  `);

  const summary = rows[0];

  if (!summary) {
    throw new Error('MariaDB não retornou o resumo do banco');
  }

  return {
    tableCount: Number(summary.tableCount),
  };
};


interface DatabaseCatalogRow extends RowDataPacket {
  tableName: string;
  columnName: string;
  ordinalPosition: number;
  dataType: string;
  columnType: string;
  isNullable: 'YES' | 'NO';
  columnKey: string;
}

const technicalTables = new Set([
  'cache',
  'cache_locks',
  'failed_jobs',
  'jobs',
  'job_batches',
  'migrations',
  'password_reset_tokens',
  'personal_access_tokens',
  'sessions',
]);

const sensitiveTables = new Set([
  'cadastro_tdas',
  'captacao_credenciados',
  'captacao_pessoas',
  'captacao_tdas',
  'captacoes',
  'convidados',
  'credenciados',
  'pessoas',
  'reeducandos',
  'users',
]);

const classifyTable = (tableName: string) => {
  if (technicalTables.has(tableName)) {
    return {
      category: 'technical',
      sensitivity: 'internal',
      queryable: false,
    };
  }

  if (sensitiveTables.has(tableName)) {
    return {
      category: 'business',
      sensitivity: 'personal',
      queryable: true,
    };
  }

  if (tableName.startsWith('politica_')) {
    return {
      category: 'politics',
      sensitivity: 'restricted',
      queryable: true,
    };
  }

  if (
    tableName.startsWith('oficio_') ||
    tableName === 'documentos'
  ) {
    return {
      category: 'documents',
      sensitivity: 'restricted',
      queryable: true,
    };
  }

  return {
    category: 'business',
    sensitivity: 'normal',
    queryable: true,
  };
};

export const getDatabaseCatalog = async () => {
  const [rows] = await pool.query<DatabaseCatalogRow[]>(`
    SELECT
      table_name AS tableName,
      column_name AS columnName,
      ordinal_position AS ordinalPosition,
      data_type AS dataType,
      column_type AS columnType,
      is_nullable AS isNullable,
      column_key AS columnKey
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
    ORDER BY table_name, ordinal_position
  `);

  const tables = new Map<
    string,
    {
      name: string;
      category: string;
      sensitivity: string;
      queryable: boolean;
      columns: Array<{
        name: string;
        dataType: string;
        columnType: string;
        nullable: boolean;
        key: string | null;
      }>;
    }
  >();

  for (const row of rows) {
    let table = tables.get(row.tableName);

    if (!table) {
      table = {
        name: row.tableName,
        ...classifyTable(row.tableName),
        columns: [],
      };

      tables.set(row.tableName, table);
    }

    table.columns.push({
      name: row.columnName,
      dataType: row.dataType,
      columnType: row.columnType,
      nullable: row.isNullable === 'YES',
      key: row.columnKey || null,
    });
  }

  const catalog = [...tables.values()];

  return {
    generatedAt: new Date().toISOString(),
    dynamic: true,
    tableCount: catalog.length,
    queryableTableCount: catalog.filter(
      table => table.queryable,
    ).length,
    tables: catalog,
  };
};

interface RecordCountRow extends RowDataPacket {
  total: number;
}

export const countTableRecords = async (
  tableName: string,
) => {
  if (!/^[a-z0-9_]+$/.test(tableName)) {
    throw new Error('Nome de tabela inválido');
  }

  const catalog = await getDatabaseCatalog();

  const table = catalog.tables.find(
    item => item.name === tableName,
  );

  if (!table) {
    throw new Error('Tabela não encontrada');
  }

  if (!table.queryable) {
    throw new Error('Tabela não autorizada para consulta');
  }

  const [rows] = await pool.query<RecordCountRow[]>(`
    SELECT COUNT(*) AS total
    FROM \`${tableName}\`
  `);

  const result = rows[0];

  if (!result) {
    throw new Error('MariaDB não retornou a contagem');
  }

  return {
    operation: 'count_records',
    table: tableName,
    total: Number(result.total),
    sensitivity: table.sensitivity,
  };
};

export const executeSafeSelect = async (
  rawSql: unknown,
) => {
  const configuredMaximumRows = Number(
    process.env.DATABASE_QUERY_MAX_ROWS ?? 100,
  );

  const maximumRows =
    Number.isInteger(configuredMaximumRows) &&
    configuredMaximumRows >= 1 &&
    configuredMaximumRows <= 500
      ? configuredMaximumRows
      : 100;

  const catalog = await getDatabaseCatalog();

  const allowedTables = new Set(
    catalog.tables
      .filter(table => table.queryable)
      .map(table => table.name),
  );

  const validated = validateSelectSql(
    rawSql,
    {
      allowedTables,
      maximumRows,
      blockedColumns: new Set([
        'password',
        'remember_token',
        'token',
      ]),
    },
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    validated.sql,
  );

  return {
    operation: 'safe_select',
    tables: validated.tables,
    rowCount: rows.length,
    maximumRows: validated.limit,
    possiblyTruncated:
      rows.length === validated.limit &&
      !/\b(count|sum|avg|min|max)\s*\(/i.test(validated.sql),
    rows,
  };
};

interface DatabaseRelationshipRow extends RowDataPacket {
  tableName: string;
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
}

export interface DatabaseRelationship {
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export const getDatabaseRelationships = async (
): Promise<DatabaseRelationship[]> => {
  const [rows] =
    await pool.query<DatabaseRelationshipRow[]>(`
      SELECT
        table_name AS tableName,
        column_name AS columnName,
        referenced_table_name AS referencedTableName,
        referenced_column_name AS referencedColumnName
      FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE()
        AND referenced_table_name IS NOT NULL
        AND referenced_column_name IS NOT NULL
      ORDER BY
        table_name,
        column_name
    `);

  return rows.map(row => ({
    table: row.tableName,
    column: row.columnName,
    referencedTable:
      row.referencedTableName,
    referencedColumn:
      row.referencedColumnName,
  }));
};

interface NamedEntityRow extends RowDataPacket {
  id: number | string;
  name: string;
}

export interface ResolvedNamedEntity {
  searchedValue: string;
  table: string;
  id: number | string;
  name: string;
  exact: boolean;
}

export const resolveNamedEntities = async (
  searchedValues: readonly string[],
  candidateTables: readonly string[],
): Promise<ResolvedNamedEntity[]> => {
  const catalog = await getDatabaseCatalog();

  const allowedTables = new Set(
    catalog.tables
      .filter(table =>
        table.queryable &&
        table.columns.some(column => column.name === 'id') &&
        table.columns.some(column => column.name === 'nome'),
      )
      .map(table => table.name),
  );

  const safeTables = [
    ...new Set(candidateTables),
  ].filter(table =>
    /^[a-z0-9_]+$/.test(table) &&
    allowedTables.has(table),
  );

  const safeValues = [
    ...new Set(
      searchedValues
        .map(value => value.trim())
        .filter(value =>
          value.length >= 2 &&
          value.length <= 150 &&
          !/^\$\d+$/.test(value),
        ),
    ),
  ];

  const matches: ResolvedNamedEntity[] = [];

  const escapeLikePattern = (value: string) =>
    value.replace(/[\\%_]/g, character => `\\${character}`);

  for (const searchedValue of safeValues) {
    for (const table of safeTables) {
      const [rows] = await pool.query<NamedEntityRow[]>(
        `
          SELECT
            id,
            nome AS name
          FROM \`${table}\`
          WHERE LOWER(nome) = LOWER(?)
             OR nome LIKE ? ESCAPE '\\\\'
          ORDER BY
            CASE
              WHEN LOWER(nome) = LOWER(?) THEN 0
              ELSE 1
            END,
            nome
          LIMIT 5
        `,
        [
          searchedValue,
          `%${escapeLikePattern(searchedValue)}%`,
          searchedValue,
        ],
      );

      for (const row of rows) {
        matches.push({
          searchedValue,
          table,
          id: row.id,
          name: row.name,
          exact:
            row.name.localeCompare(
              searchedValue,
              'pt-BR',
              { sensitivity: 'base' },
            ) === 0,
        });
      }
    }
  }

  return matches;
};

export const closeDatabase = async (): Promise<void> => {
  await pool.end();
};
