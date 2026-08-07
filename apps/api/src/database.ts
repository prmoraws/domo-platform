import {
  createPool,
  type RowDataPacket,
} from 'mysql2/promise';


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

export const closeDatabase = async (): Promise<void> => {
  await pool.end();
};