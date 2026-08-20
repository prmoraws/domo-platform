import type {
  DatabaseQueryPlan,
  PlannerRelationship,
  PlannerTable,
} from './database-query-planner.js';

interface OllamaResponse {
  message?: {
    content?: string;
  };
}

interface GeneratedDatabaseQuery {
  sql: string;
  explanation: string;
}

const ollamaUrl =
  process.env.OLLAMA_URL ?? 'http://ollama:11434';

const ollamaModel =
  process.env.OLLAMA_MODEL ?? 'qwen3.5:4b';

const formatAnswerValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return 'não informado';
  }

  if (typeof value === 'boolean') {
    return value ? 'sim' : 'não';
  }

  if (value instanceof Date) {
    return value.toLocaleDateString('pt-BR');
  }

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
      const [year, month, day] = value.slice(0, 10).split('-');
      return `${day}/${month}/${year}`;
    }

    if (
      (value.startsWith('{') && value.endsWith('}')) ||
      (value.startsWith('[') && value.endsWith(']'))
    ) {
      try {
        return formatAnswerValue(JSON.parse(value));
      } catch {
        return value;
      }
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(formatAnswerValue).join(', ');
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, nestedValue]) =>
        `${key.replaceAll('_', ' ')}: ${formatAnswerValue(nestedValue)}`,
      )
      .join('; ');
  }

  return String(value);
};

export const selectRelevantTables = async (
  question: string,
  availableTables: readonly string[],
  tableDescriptions: readonly string[],
): Promise<string[]> => {
  const response = await fetch(
    `${ollamaUrl}/api/chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        think: false,
        format: {
          type: 'object',
          properties: {
            tables: {
              type: 'array',
              items: {
                type: 'string',
                enum: availableTables,
              },
              maxItems: 5,
            },
          },
          required: ['tables'],
        },
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: 'system',
            content: [
              'Selecione até cinco tabelas necessárias',
              'para responder à pergunta.',
              'Use somente nomes fornecidos na lista.',
              'Não invente nomes de tabelas.',
              'Os nomes podem estar sem acentos',
              'ou usar plurais não convencionais.',
              'A tabela regiaos representa regiões.',
              'Use exatamente regiaos no SQL.',
              'Nunca escreva regiao, regioes ou regiaoos',
              'como nome dessa tabela.',
              'Se uma entidade for filtrada por outra,',
              'selecione as duas tabelas relacionadas.',
              'Perguntas sobre regiões de um bloco',
              'exigem as tabelas regiaos e blocos.',
              '',
              'TABELAS E COLUNAS RELACIONAIS:',
              tableDescriptions.join('\n'),
            ].join('\n'),
          },
          {
            role: 'user',
            content: question,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Ollama retornou HTTP ${response.status}`,
    );
  }

  const ollama =
    await response.json() as OllamaResponse;

  const content = ollama.message?.content;

  if (!content) {
    throw new Error(
      'Ollama não selecionou tabelas',
    );
  }

  const parsed = JSON.parse(content) as {
    tables?: unknown;
  };

  if (!Array.isArray(parsed.tables)) {
    throw new Error(
      'Ollama retornou seleção inválida',
    );
  }

  const allowedTables = new Set(
    availableTables,
  );

  const tableAliases = new Map([
    ['regiao', 'regiaos'],
    ['regioes', 'regiaos'],
  ]);

  const selectedTables = [
    ...new Set(
      parsed.tables
        .filter(
          (table): table is string =>
            typeof table === 'string',
        )
        .map(table =>
          table
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase(),
        )
        .map(table =>
          tableAliases.get(table) ?? table,
        )
        .filter(table =>
          allowedTables.has(table),
        ),
    ),
  ];

  const normalizedQuestion = question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (
    normalizedQuestion.includes('regiao') ||
    normalizedQuestion.includes('regioes')
  ) {
    if (
      allowedTables.has('regiaos') &&
      !selectedTables.includes('regiaos')
    ) {
      selectedTables.push('regiaos');
    }
  }

  if (
    normalizedQuestion.includes('bloco') &&
    allowedTables.has('blocos') &&
    !selectedTables.includes('blocos')
  ) {
    selectedTables.push('blocos');
  }

  selectedTables.splice(5);

  if (selectedTables.length === 0) {
    throw new Error(
      'Nenhuma tabela relevante foi identificada',
    );
  }

  return selectedTables;
};

const normalizeLegacyTableNames = (
  sql: string,
): string =>
  sql.replace(
    /\b(FROM|JOIN)\s+`?(?:regiao|regioes|regiaoos|regiao_r)`?\b/gi,
    '$1 regiaos',
  );

const sanitizeGeneratedSql = (
  value: string,
): string => value
  .replace(/^```(?:sql)?\s*/i, '')
  .replace(/\s*```$/i, '')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*(?:--|#).*$/gm, '')
  .trim()
  .replace(/;\s*$/, '');

interface QueryRepairContext {
  sql: string;
  error: string;
}

export const generateDatabaseQuery = async (
  question: string,
  databaseSchema: string,
  repair?: QueryRepairContext,
): Promise<GeneratedDatabaseQuery> => {
  const response = await fetch(
    `${ollamaUrl}/api/chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        think: false,
        format: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
            },
            explanation: {
              type: 'string',
            },
          },
          required: [
            'sql',
            'explanation',
          ],
        },
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: 'system',
            content: [
              'Converta a pergunta em uma consulta MariaDB.',
              'Produza somente uma instrução SELECT.',
              'Nunca use SELECT *.',
              'Nunca use comentários, UNION ou ponto e vírgula.',
              'Nunca use INSERT, UPDATE, DELETE, DROP ou ALTER.',
              'Use somente tabelas e colunas presentes no esquema.',
              'Não consulte senhas, tokens ou credenciais.',
              'Use LIMIT máximo 20, exceto em agregações.',
              'Use alias AS total em consultas COUNT.',
              'Quando necessário, use JOIN entre as tabelas.',
              'Campos terminados em _id normalmente referenciam',
              'a coluna id da tabela relacionada.',
              'regiaos.bloco_id referencia blocos.id.',
              'A tabela regiaos representa regiões.',
              '',
              ...(repair
                ? [
                  'A consulta anterior foi recusada.',
                  `SQL recusado: ${repair.sql}`,
                  `Erro recebido: ${repair.error}`,
                  'Corrija a consulta usando somente',
                  'o esquema e os relacionamentos fornecidos.',
                ]
                : []),
              'ESQUEMA AUTORIZADO:',
              databaseSchema,
            ].join('\n'),
          },
          {
            role: 'user',
            content: question,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Ollama retornou HTTP ${response.status}`,
    );
  }

  const ollama =
    await response.json() as OllamaResponse;

  const content = ollama.message?.content;

  if (!content) {
    throw new Error(
      'Ollama não retornou uma consulta',
    );
  }

  const generated =
    JSON.parse(content) as Partial<GeneratedDatabaseQuery>;

  if (
    typeof generated.sql !== 'string' ||
    typeof generated.explanation !== 'string'
  ) {
    throw new Error(
      'Ollama retornou formato inválido',
    );
  }

  const sql = normalizeLegacyTableNames(
    sanitizeGeneratedSql(generated.sql),
  );

  if (!sql) {
    throw new Error(
      'Ollama retornou SQL vazio',
    );
  }

  return {
    sql,
    explanation: generated.explanation.trim(),
  };
};

export const generateDatabaseAnswer = async (
  question: string,
  explanation: string,
  rows: unknown,
  answerMode: 'list' | 'aggregate',
): Promise<string> => {
  const fallbackAnswer = (): string => {
    if (!Array.isArray(rows) || rows.length === 0) {
      return 'Nenhum registro foi encontrado.';
    }

    if (rows.length === 1) {
      const row = rows[0];

      if (
        row &&
        typeof row === 'object' &&
        !Array.isArray(row)
      ) {
        const entries = Object.entries(row);

        if (
          entries.length === 1 &&
          typeof entries[0]?.[1] === 'number'
        ) {
          return `Resultado: ${entries[0][1]}.`;
        }

        return entries
          .map(([key, value]) =>
            `${key}: ${formatAnswerValue(value)}`,
          )
          .join(' — ');
      }
    }

    const lines = rows.map((row, index) => {
      if (
        row &&
        typeof row === 'object' &&
        !Array.isArray(row)
      ) {
        const values = Object.values(row)
          .filter(value => value !== null)
          .map(formatAnswerValue);

        return `${index + 1}. ${values.join(' — ')}`;
      }

      return `${index + 1}. ${String(row)}`;
    });

    return `Resultados encontrados:\n${lines.join('\n')}`;
  };

  const response = await fetch(
    `${ollamaUrl}/api/chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        think: false,
        format: {
          type: 'object',
          properties: {
            answer: {
              type: 'string',
              description:
                'Frase completa, natural e legível em português brasileiro.',
            },
          },
          required: ['answer'],
        },
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: 'system',
            content: [
              'Responda em português brasileiro.',
              'Seja objetivo e natural.',
              'O campo answer deve conter uma frase completa.',
              'Nunca coloque JSON dentro do campo answer.',
              'Para contagens, responda: Existem N registros.',
              answerMode === 'list'
                ? 'Esta é uma LISTAGEM: escreva os nomes recebidos, não apenas a quantidade.'
                : 'Este é um RESULTADO AGREGADO: explique o número recebido.',
              'Use somente os dados fornecidos.',
              'Campos JSON representam respostas estruturadas de formulário.',
              'Interprete objetos, listas, rádio e checkbox de forma legível.',
              'Apresente booleanos como sim ou não.',
              'Apresente datas no padrão brasileiro DD/MM/AAAA.',
              'Inclua todos os registros recebidos,',
              'sem omitir valores da resposta.',
              'Não invente informações.',
              'Não mencione SQL, tabelas ou detalhes técnicos',
              'a menos que isso seja solicitado.',
              'Não revele senhas, tokens ou credenciais.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `PERGUNTA: ${question}`,
              `EXPLICAÇÃO: ${explanation}`,
              `RESULTADO: ${JSON.stringify(rows)}`,
            ].join('\n'),
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    return fallbackAnswer();
  }

  const ollama =
    await response.json() as OllamaResponse;

  const content = ollama.message?.content;

  if (!content) {
    return fallbackAnswer();
  }

  let parsed: {
    answer?: unknown;
  };

  try {
    parsed = JSON.parse(content) as {
      answer?: unknown;
    };
  } catch {
    return content.trim() || fallbackAnswer();
  }

  if (
    typeof parsed.answer !== 'string' ||
    !parsed.answer.trim()
  ) {
    return fallbackAnswer();
  }

  if (
    answerMode === 'list' &&
    Array.isArray(rows)
  ) {
    const normalizedAnswer = parsed.answer
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const returnedValues = rows
      .flatMap(row =>
        row &&
        typeof row === 'object' &&
        !Array.isArray(row)
          ? Object.values(row)
          : [row],
      )
      .filter(
        (value): value is string =>
          typeof value === 'string' &&
          value.trim().length > 0,
      );

    const includesEveryValue = returnedValues.every(value =>
      normalizedAnswer.includes(
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase(),
      ),
    );

    if (!includesEveryValue) {
      return fallbackAnswer();
    }
  }

  return parsed.answer.trim();
};

export const generateDatabaseQueryPlan = async (
  question: string,
  tables: readonly PlannerTable[],
  relationships: readonly PlannerRelationship[],
): Promise<DatabaseQueryPlan> => {
  const availableTables = tables.map(table => table.name);
  const availableFields = tables.flatMap(table =>
    table.columns.map(column =>
      `${table.name}.${column.name}`,
    ),
  );

  const schemaDescription = tables
    .map(table =>
      `${table.name}(${table.columns.map(column =>
        `${column.name}:${column.dataType ?? column.columnType ?? 'desconhecido'}`,
      ).join(', ')})`,
    )
    .join('\n');

  const relationshipDescription = relationships
    .map(relationship =>
      `${relationship.table}.${relationship.column} = ${relationship.referencedTable}.${relationship.referencedColumn}`,
    )
    .join('\n');

  const response = await fetch(
    `${ollamaUrl}/api/chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        think: false,
        format: {
          type: 'object',
          properties: {
            sourceTable: {
              type: 'string',
              enum: availableTables,
            },
            select: {
              type: 'array',
              minItems: 1,
              maxItems: 12,
              items: {
                type: 'object',
                properties: {
                  field: {
                    type: 'string',
                    enum: availableFields,
                  },
                  aggregate: {
                    type: 'string',
                    enum: [
                      'none',
                      'count',
                      'sum',
                      'avg',
                      'min',
                      'max',
                    ],
                  },
                  alias: {
                    type: 'string',
                  },
                },
                required: [
                  'field',
                  'aggregate',
                  'alias',
                ],
              },
            },
            filters: {
              type: 'array',
              maxItems: 8,
              items: {
                type: 'object',
                properties: {
                  field: {
                    type: 'string',
                    enum: availableFields,
                  },
                  operator: {
                    type: 'string',
                    enum: [
                      'equals',
                      'contains',
                      'starts_with',
                      'ends_with',
                      'greater_than',
                      'greater_or_equal',
                      'less_than',
                      'less_or_equal',
                    ],
                  },
                  value: {
                    anyOf: [
                      { type: 'string' },
                      { type: 'number' },
                      { type: 'boolean' },
                    ],
                  },
                },
                required: [
                  'field',
                  'operator',
                  'value',
                ],
              },
            },
            groupBy: {
              type: 'array',
              maxItems: 8,
              items: {
                type: 'string',
                enum: availableFields,
              },
            },
            orderBy: {
              type: 'array',
              maxItems: 8,
              items: {
                type: 'object',
                properties: {
                  field: {
                    type: 'string',
                    enum: availableFields,
                  },
                  direction: {
                    type: 'string',
                    enum: ['asc', 'desc'],
                  },
                },
                required: ['field', 'direction'],
              },
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 20,
            },
            explanation: {
              type: 'string',
            },
          },
          required: [
            'sourceTable',
            'select',
            'filters',
            'groupBy',
            'orderBy',
            'limit',
            'explanation',
          ],
        },
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: 'system',
            content: [
              'Você é o agente de dados da plataforma DOMO.',
              'Entenda livremente a pergunta e produza um plano de consulta.',
              'Não escreva SQL e não invente tabelas, campos ou relações.',
              'Escolha todos os campos necessários para responder.',
              'O servidor construirá os JOINs pelas relações existentes.',
              'Para contagem, use aggregate=count sobre o campo id',
              'da entidade contada e alias total.',
              'Para listar por grupo, selecione o campo do grupo,',
              'inclua-o em groupBy quando houver agregação e ordene-o.',
              'Bloco, região e igreja são entidades diferentes.',
              'Filtre nomes de blocos em blocos.nome.',
              'Filtre nomes de regiões em regiaos.nome.',
              'Filtre nomes de igrejas em igrejas.nome.',
              'Em "igrejas de X", use as relações para decidir',
              'se X identifica bloco, região ou igreja.',
              'Use contains quando o usuário não exigir igualdade exata.',
              'Campos do tipo json pertencem ao próprio registro.',
              'Para consultar um campo JSON, selecione esse campo inteiro.',
              'Não relacione uma coluna JSON com tabela de nome parecido.',
              'Campos date, datetime e timestamp representam datas.',
              '',
              'TABELAS E CAMPOS DISPONÍVEIS:',
              schemaDescription,
              '',
              'RELACIONAMENTOS DISPONÍVEIS:',
              relationshipDescription,
            ].join('\n'),
          },
          {
            role: 'user',
            content: question,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Ollama retornou HTTP ${response.status}`,
    );
  }

  const ollama = await response.json() as OllamaResponse;
  const content = ollama.message?.content;

  if (!content) {
    throw new Error('Ollama não retornou um plano');
  }

  return JSON.parse(content) as DatabaseQueryPlan;
};
