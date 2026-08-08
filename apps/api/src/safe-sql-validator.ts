export interface SafeSqlOptions {
  allowedTables: ReadonlySet<string>;
  maximumRows?: number;
}

export interface ValidatedSql {
  sql: string;
  tables: string[];
  limit: number;
}

const forbiddenPattern =
  /\b(insert|update|delete|drop|alter|create|truncate|replace|grant|revoke|call|execute|load|outfile|dumpfile|sleep|benchmark|union|into|procedure)\b/i;

export const validateSelectSql = (
  rawSql: unknown,
  options: SafeSqlOptions,
): ValidatedSql => {
  if (typeof rawSql !== 'string' || !rawSql.trim()) {
    throw new Error('SQL não informada');
  }

  let sql = rawSql.trim();

  if (
    sql.includes('--') ||
    sql.includes('#') ||
    sql.includes('/*') ||
    sql.includes('*/')
  ) {
    throw new Error('Comentários SQL não são permitidos');
  }

  const semicolons = [...sql].filter(
    character => character === ';',
  ).length;

  if (
    semicolons > 1 ||
    (semicolons === 1 && !sql.endsWith(';'))
  ) {
    throw new Error('Somente uma instrução SQL é permitida');
  }

  sql = sql.replace(/;$/, '').trim();

  if (!/^select\b/i.test(sql)) {
    throw new Error('Somente consultas SELECT são permitidas');
  }

  if (forbiddenPattern.test(sql)) {
    throw new Error('A SQL contém uma operação proibida');
  }

  const tables = [
    ...sql.matchAll(
      /\b(?:from|join)\s+`?([a-zA-Z0-9_]+)`?/gi,
    ),
  ].map(match => match[1]?.toLowerCase())
    .filter((table): table is string => Boolean(table));

  if (tables.length === 0) {
    throw new Error('Nenhuma tabela foi identificada');
  }

  const uniqueTables = [...new Set(tables)];

  for (const table of uniqueTables) {
    if (!options.allowedTables.has(table)) {
      throw new Error(`Tabela não autorizada: ${table}`);
    }
  }

  const maximumRows = options.maximumRows ?? 20;
  const limitMatch = sql.match(/\blimit\s+(\d+)\s*$/i);

  if (limitMatch) {
    const requestedLimit = Number(limitMatch[1]);

    if (requestedLimit > maximumRows) {
      sql = sql.replace(
        /\blimit\s+\d+\s*$/i,
        `LIMIT ${maximumRows}`,
      );
    }
  } else {
    sql = `${sql} LIMIT ${maximumRows}`;
  }

  return {
    sql,
    tables: uniqueTables,
    limit: maximumRows,
  };
};