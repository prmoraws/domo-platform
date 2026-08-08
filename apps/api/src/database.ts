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
  const catalog = await getDatabaseCatalog();

  const allowedTables = new Set(
    catalog.tables
      .filter(table =>
        table.queryable &&
        table.sensitivity === 'normal',
      )
      .map(table => table.name),
  );

  const validated = validateSelectSql(
    rawSql,
    {
      allowedTables,
      maximumRows: 20,
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
    rows,
  };
};

export const closeDatabase = async (): Promise<void> => {
  await pool.end();
};