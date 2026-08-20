import manifest from './database-domain-manifest.json' with {
  type: 'json',
};

import {
  executeSafeSelect,
  getDatabaseCatalog,
  getDatabaseRelationships,
  resolveNamedEntities,
} from './database.js';

import {
  findRelationshipPathInGraph,
} from './relationship-path.js';

type Catalog = Awaited<ReturnType<typeof getDatabaseCatalog>>;

const protectedSchemaColumn =
  /^(password|senha|token|remember_token|secret|api_key)$/i;

const filterCatalog = (
  catalog: Catalog,
  requestedTableNames?: readonly string[],
) => {
  const requested = requestedTableNames?.length
    ? new Set(requestedTableNames)
    : undefined;

  return catalog.tables
    .filter(table =>
      table.queryable &&
      (!requested || requested.has(table.name)),
    )
    .map(table => ({
      ...table,
      columns: table.columns.filter(
        column => !protectedSchemaColumn.test(column.name),
      ),
    }));
};

export const createDatabaseAgentTools = () => ({
  describeDatabase: async (
    tableNames?: readonly string[],
  ) => {
    const [catalog, relationships] = await Promise.all([
      getDatabaseCatalog(),
      getDatabaseRelationships(),
    ]);

    const tables = filterCatalog(catalog, tableNames);
    const included = new Set(tables.map(table => table.name));
    const domainTables = manifest.tables as Record<
      string,
      unknown
    >;

    return {
      dynamic: true,
      aliases: manifest.aliases,
      tables: tables.map(table => ({
        ...table,
        domain: domainTables[table.name],
      })),
      relationships: relationships.filter(relationship =>
        included.has(relationship.table) &&
        included.has(relationship.referencedTable),
      ),
      sourceDiscrepancies: manifest.sourceDiscrepancies,
    };
  },

  describeTable: async (tableName: string) => {
    const [catalog, relationships] = await Promise.all([
      getDatabaseCatalog(),
      getDatabaseRelationships(),
    ]);
    const tables = filterCatalog(catalog, [tableName]);
    const table = tables[0];

    if (!table) {
      throw new Error('Tabela não autorizada ou inexistente');
    }

    const domainTables = manifest.tables as Record<
      string,
      unknown
    >;

    return {
      dynamic: true,
      table: {
        ...table,
        domain: domainTables[table.name],
      },
      relationships: relationships.filter(relationship =>
        relationship.table === tableName ||
        relationship.referencedTable === tableName,
      ),
    };
  },

  searchEntities: async (
    query: string,
    tableNames?: readonly string[],
  ) => {
    const catalog = await getDatabaseCatalog();
    const candidateTables = tableNames?.length
      ? tableNames
      : catalog.tables
        .filter(table =>
          table.queryable &&
          table.columns.some(column => column.name === 'id') &&
          table.columns.some(column => column.name === 'nome'),
        )
        .map(table => table.name);

    return resolveNamedEntities([query], candidateTables);
  },

  findRelationshipPath: async (
    fromTable: string,
    toTable: string,
  ) => {
    if (
      !/^[a-z0-9_]+$/.test(fromTable) ||
      !/^[a-z0-9_]+$/.test(toTable)
    ) {
      throw new Error('Nome de tabela inválido');
    }

    const [catalog, relationships] = await Promise.all([
      getDatabaseCatalog(),
      getDatabaseRelationships(),
    ]);
    const allowed = new Set(
      catalog.tables
        .filter(table => table.queryable)
        .map(table => table.name),
    );

    if (!allowed.has(fromTable) || !allowed.has(toTable)) {
      throw new Error('Tabela não autorizada ou inexistente');
    }

    return {
      fromTable,
      toTable,
      path: findRelationshipPathInGraph(
        relationships,
        fromTable,
        toTable,
      ),
    };
  },

  executeSelect: executeSafeSelect,
});

export const getQueryableTableNames = async () => {
  const catalog = await getDatabaseCatalog();

  return catalog.tables
    .filter(table => table.queryable)
    .map(table => table.name);
};
