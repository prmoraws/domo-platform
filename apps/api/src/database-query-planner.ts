export type QueryAggregate =
  | 'none'
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max';

export interface DatabaseQueryPlan {
  sourceTable: string;
  select: Array<{
    field: string;
    aggregate: QueryAggregate;
    alias?: string;
  }>;
  filters: Array<{
    field: string;
    operator:
      | 'equals'
      | 'contains'
      | 'starts_with'
      | 'ends_with'
      | 'greater_than'
      | 'greater_or_equal'
      | 'less_than'
      | 'less_or_equal';
    value: string | number | boolean;
  }>;
  groupBy: string[];
  orderBy: Array<{
    field: string;
    direction: 'asc' | 'desc';
  }>;
  limit: number;
  explanation: string;
}

export interface PlannerTable {
  name: string;
  columns: Array<{
    name: string;
    dataType?: string;
    columnType?: string;
  }>;
}

export interface PlannerRelationship {
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface PlannerResolvedEntity {
  searchedValue: string;
  table: string;
  id: number | string;
  name: string;
  exact: boolean;
}

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export const extractEntitySearchValues = (
  plan: DatabaseQueryPlan,
): string[] => [
  ...new Set(
    plan.filters
      .map(filter => filter.value)
      .filter(
        (value): value is string =>
          typeof value === 'string',
      )
      .map(value => value.trim())
      .filter(value =>
        value.length >= 2 &&
        !/^\$\d+$/.test(value),
      ),
  ),
];

export const extractQuestionEntityHints = (
  question: string,
): string[] => {
  const hints: string[] = [];
  const roleMatch = question.match(
    /quem\s+(?:e|é)\s+(?:o|a)\s+(.+?)\s+(?:(?:do|da)\s+(?:bloco|regi[aã]o|igreja)\b)/i,
  );

  if (roleMatch?.[1]) {
    hints.push(roleMatch[1].trim());
  }

  return [...new Set(hints.filter(value => value.length >= 2))];
};

export const normalizeDatabaseQueryPlan = (
  question: string,
  originalPlan: DatabaseQueryPlan,
  tables: readonly PlannerTable[],
  resolvedEntities: readonly PlannerResolvedEntity[],
): DatabaseQueryPlan => {
  const normalizedQuestion = normalizeText(question);
  const asksForCount =
    /\b(quantos?|quantas?|quantidade|total|numero de)\b/.test(
      normalizedQuestion,
    ) ||
    /\bregistros?\s+(tem|existem|ha)\b/.test(
      normalizedQuestion,
    );

  const asksForIdentity = /\bquem\b/.test(normalizedQuestion);
  const lookupSource = tables.find(table =>
    table.name === originalPlan.sourceTable,
  );
  const lookupQuestion = normalizedQuestion
    .split(/\b(?:qual|quais)\s+(?:(?:o|a|os|as)\s+)?/)[1];
  const lookupColumnMatches = lookupQuestion
    ? (lookupSource?.columns ?? [])
      .map(column => ({
        column: column.name,
        index: lookupQuestion.search(
          new RegExp(`\\b${normalizeText(column.name)}\\b`),
        ),
      }))
      .filter(match => match.index >= 0)
      .sort((first, second) => second.index - first.index)
    : [];
  const directLookupColumn = lookupColumnMatches[0];
  const relatedLookup = lookupQuestion
    ? tables
      .filter(table => table.name !== originalPlan.sourceTable)
      .map(table => {
        const label = normalizeText(table.name).replace(/s$/, '');
        const sourceHasForeignKey = lookupSource?.columns.some(
          column => column.name === `${label}_id`,
        );
        const match = sourceHasForeignKey
          ? lookupQuestion.match(
            new RegExp(
              `^(?:nome\\s+(?:do|da)\\s+)?${label}\\s+(?:de|do|da)\\s+(.+?)(?:\\?|$)`,
            ),
          )
          : null;

        return match?.[1]
          ? {
            table: table.name,
            label,
            entityName: match[1].trim(),
          }
          : undefined;
      })
      .find(match => match !== undefined)
    : undefined;
  const booleanLookup = normalizedQuestion.match(
    /\bse\s+(.+?)\s+(?:ja\s+)?(?:foi|e|esta)\s+([a-z0-9_]+)\b/,
  );
  const booleanLookupColumn = booleanLookup?.[2] &&
    lookupSource?.columns.some(column =>
      normalizeText(column.name) === booleanLookup[2],
    )
      ? booleanLookup[2]
      : undefined;
  const requestedLookupColumn =
    directLookupColumn?.column ?? booleanLookupColumn;
  const rawLookupEntityName = directLookupColumn && lookupQuestion
    ? lookupQuestion
      .slice(
        directLookupColumn.index +
        normalizeText(directLookupColumn.column).length,
      )
      .replace(/^\s+(?:de|do|da|no|na|em)\s+/, '')
    : relatedLookup?.entityName ?? booleanLookup?.[1];
  const sourceLabel = normalizeText(originalPlan.sourceTable)
    .replace(/s$/, '');
  const lookupEntityName = rawLookupEntityName
    ?.replace(/[?,.]+$/, '')
    .replace(
      originalPlan.sourceTable === 'presidios'
        ? /$^/
        : new RegExp(
          `^(?:${sourceLabel}|${sourceLabel}s)\\s+(?:de\\s+)?`,
        ),
      '',
    )
    .trim();
  const asksForLookup = Boolean(
    (requestedLookupColumn || relatedLookup) && lookupEntityName,
  );
  const asksForList =
    /\b(liste|listar|quais|qual|mostre|relacione|quem)\b/.test(
      normalizedQuestion,
    ) || asksForLookup;

  const asksForGroupedCount =
    asksForCount &&
    /\b(por|cada)\s+[a-z]/.test(normalizedQuestion);

  const countedSubject = normalizedQuestion.match(
    /\bquant(?:os|as?)\s+([a-z0-9_]+)/,
  )?.[1];

  const inferredCountTable = countedSubject
    ? tables.find(table => {
      const tableName = normalizeText(table.name);

      return (
        tableName === countedSubject ||
        tableName.replace(/s$/, '') === countedSubject
      );
    })?.name
    : undefined;

  const sourceTable = (() => {
    if (
      asksForIdentity &&
      tables.some(table => table.name === 'pessoas')
    ) {
      return 'pessoas';
    }

    if (asksForCount && inferredCountTable) {
      return inferredCountTable;
    }

    return originalPlan.sourceTable;
  })();

  const availableFields = new Set(
    tables.flatMap(table =>
      table.columns.map(column =>
        `${table.name}.${column.name}`,
      ),
    ),
  );

  const preferredEntityTable = (() => {
    if (/\bbloco\b/.test(normalizedQuestion)) {
      return 'blocos';
    }

    if (/\bregiao\b/.test(normalizedQuestion)) {
      return 'regiaos';
    }

    if (/\bigreja\b/.test(normalizedQuestion)) {
      return 'igrejas';
    }

    return undefined;
  })();

  const filters = originalPlan.filters
    .filter(filter => {
      if (
        typeof filter.value === 'string' &&
        filter.value.trim() === ''
      ) {
        return false;
      }

      if (requestedLookupColumn || relatedLookup) {
        return false;
      }

      const column = filter.field.split('.')[1];

      if (
        (column === 'id' || column?.endsWith('_id')) &&
        !normalizedQuestion.includes(
          String(filter.value).toLowerCase(),
        )
      ) {
        return false;
      }

      if (
        column?.endsWith('_id') &&
        typeof filter.value === 'string' &&
        !/^\d+$/.test(filter.value)
      ) {
        return false;
      }

      return !(
        typeof filter.value === 'string' &&
        /^\$\d+$/.test(filter.value)
      );
    })
    .filter(filter => {
      if (typeof filter.value !== 'string') {
        return true;
      }

      const filterValue = filter.value;

      return !resolvedEntities.some(entity =>
        normalizeText(entity.searchedValue) ===
        normalizeText(filterValue),
      );
    });

  const searchedValues = [
    ...new Set([
      ...extractEntitySearchValues(originalPlan),
      ...resolvedEntities
        .filter(entity =>
          normalizedQuestion.includes(
            normalizeText(entity.searchedValue),
          ),
        )
        .map(entity => entity.searchedValue),
    ]),
  ];

  for (const searchedValue of searchedValues) {
    const matches = resolvedEntities.filter(entity =>
      normalizeText(entity.searchedValue) ===
      normalizeText(searchedValue),
    );

    if (matches.length === 0) {
      continue;
    }

    const exactMatches = matches.filter(entity => entity.exact);
    const candidates = exactMatches.length > 0
      ? exactMatches
      : matches;

    const resolved =
      candidates.length === 1
        ? candidates[0]
        : candidates.find(entity =>
          entity.table === preferredEntityTable,
        );

    if (!resolved) {
      continue;
    }

    const idField = `${resolved.table}.id`;

    if (!availableFields.has(idField)) {
      continue;
    }

    filters.push({
      field: idField,
      operator: 'equals',
      value:
        typeof resolved.id === 'string' &&
        /^\d+$/.test(resolved.id)
          ? Number(resolved.id)
          : resolved.id,
    });
  }

  const sourceDefinition = tables.find(table =>
    table.name === sourceTable,
  );

  for (const column of sourceDefinition?.columns ?? []) {
    if (
      column.name === 'id' ||
      column.name === 'nome' ||
      column.name.endsWith('_id') ||
      column.name.endsWith('_at')
    ) {
      continue;
    }

    if (column.name === requestedLookupColumn) {
      continue;
    }

    const normalizedColumn = normalizeText(column.name);
    const attributeMatch = normalizedQuestion.match(
      new RegExp(
        `\\b${normalizedColumn}\\s+(?:de|e|igual a)\\s+(.+?)(?=\\?|\\s+(?:no|na|do|da)\\s+(?:bloco|regiao|igreja)\\b|$)`,
      ),
    );

    const value = attributeMatch?.[1]?.trim();

    if (!value) {
      continue;
    }

    const field = `${sourceTable}.${column.name}`;

    if (!filters.some(filter => filter.field === field)) {
      filters.push({
        field,
        operator: 'contains',
        value,
      });
    }
  }

  if (
    lookupEntityName &&
    availableFields.has(`${sourceTable}.nome`) &&
    !filters.some(filter =>
      filter.field === `${sourceTable}.nome`,
    )
  ) {
    filters.push({
      field: `${sourceTable}.nome`,
      operator: 'contains',
      value: lookupEntityName,
    });
  }

  let select = originalPlan.select;
  let groupBy = originalPlan.groupBy;
  let orderBy = originalPlan.orderBy;

  if (asksForCount && !asksForList) {
    const idField = `${sourceTable}.id`;

    if (availableFields.has(idField)) {
      select = [{
        field: idField,
        aggregate: 'count',
        alias: 'total',
      }];
    }

    if (!asksForGroupedCount) {
      groupBy = [];
      orderBy = [];
    }
  } else if (asksForList) {
    select = originalPlan.select.map(selection => {
      const alias =
        selection.alias === 'total'
          ? selection.field.split('.')[1] ?? 'valor'
          : selection.alias;

      return {
        field: selection.field,
        aggregate: 'none' as const,
        ...(alias ? { alias } : {}),
      };
    });

    const sourceName = `${sourceTable}.nome`;

    if (
      availableFields.has(sourceName) &&
      !select.some(selection =>
        selection.field === sourceName,
      )
    ) {
      select.push({
        field: sourceName,
        aggregate: 'none',
        alias: 'nome',
      });
    }

    const requestedNamedTables = [
      {
        table: 'igrejas',
        requested: /\bigrejas?\b/.test(normalizedQuestion),
        alias: 'igreja',
      },
      {
        table: 'regiaos',
        requested:
          sourceTable === 'regiaos' ||
          /\bpor regiao\b/.test(normalizedQuestion) ||
          /\borganize por regiao\b/.test(normalizedQuestion) ||
          /\bnomes? das? (?:igrejas? e )?regioes\b/.test(
            normalizedQuestion,
          ) ||
          /\bigrejas? e regioes\b/.test(normalizedQuestion),
        alias: 'regiao',
      },
      {
        table: 'blocos',
        requested:
          sourceTable === 'blocos' ||
          /\b(?:liste|quais|mostre).*\bblocos\b/.test(
            normalizedQuestion,
          ) ||
          /\b(?:por|organize por) bloco\b/.test(
            normalizedQuestion,
          ),
        alias: 'bloco',
      },
    ];

    for (const requested of requestedNamedTables) {
      const field = `${requested.table}.nome`;

      const existing = select.find(selection =>
        selection.field === field,
      );

      if (requested.requested && existing) {
        existing.alias = requested.alias;
        continue;
      }

      if (
        requested.requested &&
        availableFields.has(field) &&
        !select.some(selection =>
          selection.field === field,
        )
      ) {
        select.push({
          field,
          aggregate: 'none',
          alias: requested.alias,
        });
      }
    }

    groupBy = [];

    if (asksForIdentity) {
      const personName = 'pessoas.nome';

      if (availableFields.has(personName)) {
        select = [{
          field: personName,
          aggregate: 'none',
          alias: 'pessoa',
        }];

        orderBy = [{
          field: personName,
          direction: 'asc',
        }];
      }
    }


    if (
      requestedLookupColumn &&
      availableFields.has(
        `${sourceTable}.${requestedLookupColumn}`,
      )
    ) {
      select = [
        ...(availableFields.has(`${sourceTable}.nome`)
          ? [{
            field: `${sourceTable}.nome`,
            aggregate: 'none' as const,
            alias: sourceLabel,
          }]
          : []),
        {
          field: `${sourceTable}.${requestedLookupColumn}`,
          aggregate: 'none',
          alias: requestedLookupColumn,
        },
      ];

      orderBy = [];
    }

    if (
      relatedLookup &&
      availableFields.has(`${relatedLookup.table}.nome`)
    ) {
      select = [
        ...(availableFields.has(`${sourceTable}.nome`)
          ? [{
            field: `${sourceTable}.nome`,
            aggregate: 'none' as const,
            alias: sourceLabel,
          }]
          : []),
        {
          field: `${relatedLookup.table}.nome`,
          aggregate: 'none',
          alias: relatedLookup.label,
        },
      ];

      orderBy = [];
    }
  }

  return {
    ...originalPlan,
    sourceTable,
    select,
    filters,
    groupBy,
    orderBy,
    limit: asksForList ? 20 : originalPlan.limit,
  };
};

const identifierPattern = /^[a-z0-9_]+$/;

const quoteIdentifier = (identifier: string): string => {
  if (!identifierPattern.test(identifier)) {
    throw new Error(`Identificador inválido: ${identifier}`);
  }

  return `\`${identifier}\``;
};

const parseField = (
  field: string,
  availableFields: ReadonlySet<string>,
) => {
  if (!availableFields.has(field)) {
    throw new Error(`Campo não autorizado: ${field}`);
  }

  const [table, column] = field.split('.');

  if (!table || !column) {
    throw new Error(`Campo inválido: ${field}`);
  }

  return {
    table,
    column,
    sql: `${quoteIdentifier(table)}.${quoteIdentifier(column)}`,
  };
};

const quoteValue = (
  value: string | number | boolean,
): string => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Número inválido no filtro');
    }

    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  return `'${value.replaceAll("'", "''")}'`;
};

interface JoinEdge {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

const buildEdges = (
  relationships: readonly PlannerRelationship[],
): JoinEdge[] =>
  relationships.flatMap(relationship => [
    {
      fromTable: relationship.table,
      fromColumn: relationship.column,
      toTable: relationship.referencedTable,
      toColumn: relationship.referencedColumn,
    },
    {
      fromTable: relationship.referencedTable,
      fromColumn: relationship.referencedColumn,
      toTable: relationship.table,
      toColumn: relationship.column,
    },
  ]);

const findPath = (
  source: string,
  target: string,
  edges: readonly JoinEdge[],
): JoinEdge[] => {
  if (source === target) {
    return [];
  }

  const queue: Array<{
    table: string;
    path: JoinEdge[];
  }> = [{ table: source, path: [] }];

  const visited = new Set([source]);

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      break;
    }

    for (const edge of edges) {
      if (
        edge.fromTable !== current.table ||
        visited.has(edge.toTable)
      ) {
        continue;
      }

      const path = [...current.path, edge];

      if (edge.toTable === target) {
        return path;
      }

      visited.add(edge.toTable);
      queue.push({
        table: edge.toTable,
        path,
      });
    }
  }

  throw new Error(
    `Não existe relacionamento entre ${source} e ${target}`,
  );
};

export const compileDatabaseQueryPlan = (
  plan: DatabaseQueryPlan,
  tables: readonly PlannerTable[],
  relationships: readonly PlannerRelationship[],
): string => {
  const tableNames = new Set(
    tables.map(table => table.name),
  );

  if (!tableNames.has(plan.sourceTable)) {
    throw new Error(
      `Tabela de origem não autorizada: ${plan.sourceTable}`,
    );
  }

  if (plan.select.length === 0) {
    throw new Error('O plano não selecionou campos');
  }

  const availableFields = new Set(
    tables.flatMap(table =>
      table.columns.map(column =>
        `${table.name}.${column.name}`,
      ),
    ),
  );

  const referencedTables = new Set([
    plan.sourceTable,
  ]);

  const registerField = (field: string) => {
    const parsed = parseField(field, availableFields);
    referencedTables.add(parsed.table);
    return parsed;
  };

  const selections = plan.select.map(selection => {
    const field = registerField(selection.field);
    const aggregate = selection.aggregate;
    const expression = aggregate === 'none'
      ? field.sql
      : `${aggregate.toUpperCase()}(${field.sql})`;

    if (!selection.alias) {
      return expression;
    }

    return `${expression} AS ${quoteIdentifier(selection.alias)}`;
  });

  for (const filter of plan.filters) {
    registerField(filter.field);
  }

  for (const field of plan.groupBy) {
    registerField(field);
  }

  for (const ordering of plan.orderBy) {
    registerField(ordering.field);
  }

  const edges = buildEdges(relationships);
  const joinedTables = new Set([plan.sourceTable]);
  const joins: string[] = [];

  for (const target of referencedTables) {
    if (joinedTables.has(target)) {
      continue;
    }

    const path = findPath(
      plan.sourceTable,
      target,
      edges,
    );

    for (const edge of path) {
      if (joinedTables.has(edge.toTable)) {
        continue;
      }

      joins.push([
        'JOIN',
        quoteIdentifier(edge.toTable),
        'ON',
        `${quoteIdentifier(edge.fromTable)}.${quoteIdentifier(edge.fromColumn)}`,
        '=',
        `${quoteIdentifier(edge.toTable)}.${quoteIdentifier(edge.toColumn)}`,
      ].join(' '));

      joinedTables.add(edge.fromTable);
      joinedTables.add(edge.toTable);
    }
  }

  const operatorSql = {
    equals: '=',
    contains: 'LIKE',
    starts_with: 'LIKE',
    ends_with: 'LIKE',
    greater_than: '>',
    greater_or_equal: '>=',
    less_than: '<',
    less_or_equal: '<=',
  } as const;

  const filters = plan.filters.map(filter => {
    const field = parseField(
      filter.field,
      availableFields,
    );

    let value = filter.value;

    if (typeof value === 'string') {
      if (filter.operator === 'contains') {
        value = `%${value}%`;
      } else if (filter.operator === 'starts_with') {
        value = `${value}%`;
      } else if (filter.operator === 'ends_with') {
        value = `%${value}`;
      }
    }

    return `${field.sql} ${operatorSql[filter.operator]} ${quoteValue(value)}`;
  });

  const groups = plan.groupBy.map(field =>
    parseField(field, availableFields).sql,
  );

  const orders = plan.orderBy.map(ordering => {
    const field = parseField(
      ordering.field,
      availableFields,
    );

    return `${field.sql} ${ordering.direction.toUpperCase()}`;
  });

  const safeLimit = Math.min(
    Math.max(Math.trunc(plan.limit || 20), 1),
    20,
  );

  const isSingleAggregateResult =
    groups.length === 0 &&
    plan.select.every(selection =>
      selection.aggregate !== 'none',
    );

  return [
    `SELECT ${selections.join(', ')}`,
    `FROM ${quoteIdentifier(plan.sourceTable)}`,
    ...joins,
    filters.length > 0
      ? `WHERE ${filters.join(' AND ')}`
      : '',
    groups.length > 0
      ? `GROUP BY ${groups.join(', ')}`
      : '',
    orders.length > 0
      ? `ORDER BY ${orders.join(', ')}`
      : '',
    isSingleAggregateResult
      ? ''
      : `LIMIT ${safeLimit}`,
  ]
    .filter(Boolean)
    .join('\n');
};
