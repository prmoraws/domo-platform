interface GeminiFunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: {
    id?: string;
    name: string;
    response: {
      ok: boolean;
      result?: unknown;
      error?: string;
    };
  };
}

interface GeminiContent {
  role?: 'user' | 'model';
  parts?: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: GeminiContent;
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
}

export interface DatabaseAgentTools {
  describeDatabase: (
    tableNames?: readonly string[],
  ) => Promise<unknown>;
  describeTable: (
    tableName: string,
  ) => Promise<unknown>;
  searchEntities: (
    query: string,
    tableNames?: readonly string[],
  ) => Promise<unknown>;
  findRelationshipPath: (
    fromTable: string,
    toTable: string,
  ) => Promise<unknown>;
  executeSelect: (
    sql: string,
  ) => Promise<unknown>;
}

export interface DatabaseAgentResult {
  answer: string;
  provider: 'gemini';
  model: string;
  iterations: number;
  toolCalls: Array<{
    name: string;
    successful: boolean;
  }>;
  generatedSql: string;
  queryResult: unknown;
  modelRequests: number;
  durationMs: number;
}

const apiUrl =
  process.env.GEMINI_API_URL ??
  'https://generativelanguage.googleapis.com/v1beta';

const model =
  process.env.GEMINI_MODEL ??
  'gemini-2.5-flash';

const maximumIterations = 8;

const generationConfig = model.startsWith('gemini-3')
  ? {
    maxOutputTokens: 4096,
    thinkingConfig: {
      thinkingLevel: 'LOW',
    },
  }
  : {
    temperature: 0.1,
    maxOutputTokens: 2048,
  };
export type DatabaseAgentUnavailableCode =
  | 'GEMINI_RATE_LIMIT'
  | 'GEMINI_MODEL_UNAVAILABLE'
  | 'GEMINI_TIMEOUT'
  | 'GEMINI_UNAVAILABLE';

export class DatabaseAgentUnavailableError extends Error {
  constructor(
    public readonly code: DatabaseAgentUnavailableCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'DatabaseAgentUnavailableError';
  }
}

let geminiBlockedUntil = 0;

export const getGeminiCircuitStatus = () => {
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((geminiBlockedUntil - Date.now()) / 1000),
  );

  return {
    state: retryAfterSeconds > 0 ? 'open' : 'closed',
    retryAfterSeconds,
  } as const;
};

const configuredRateLimitCooldown = () => {
  const value = Number(
    process.env.GEMINI_RATE_LIMIT_COOLDOWN_SECONDS ?? 60,
  );

  return Number.isInteger(value) && value >= 0 && value <= 3600
    ? value
    : 60;
};

const systemInstruction = [
  'Você é o agente de consulta da plataforma DOMO.',
  'Responda em português brasileiro, de forma clara e direta.',
  '',
  'REGRAS OBRIGATÓRIAS:',
  '1. Nunca invente tabelas, colunas, relações ou resultados.',
  '2. Use describe_database para descobrir tabelas e describe_table para inspecionar uma tabela específica.',
  '3. Para nomes de pessoas, blocos, regiões, igrejas, presídios ou outras entidades, use search_entities antes de montar o filtro.',
  '4. Use find_relationship_path quando precisar relacionar tabelas e o caminho ainda não estiver confirmado.',
  '5. Use somente execute_readonly_query para consultar dados.',
  '6. Gere apenas uma instrução SELECT; nunca altere o banco.',
  '7. Não use SELECT * e não consulte senhas, tokens ou credenciais.',
  '8. Relacione tabelas exclusivamente pelas chaves informadas no esquema.',
  '9. Se uma ferramenta recusar a consulta, analise o erro e tente corrigi-la.',
  '10. Não aplique filtros que o usuário não pediu.',
  '11. Diferencie sempre o dado solicitado da entidade usada como filtro; não transforme a frase inteira da pergunta em valor de coluna.',
  '12. Só responda com dados depois de executar uma consulta com sucesso.',
  '13. Se houver ambiguidade real entre entidades, explique e peça esclarecimento.',
  '14. Em listas, informe os itens encontrados; em contagens, informe o total. Se o resultado atingir o limite, avise que a lista pode estar truncada.',
  '15. Não mencione SQL, ferramentas ou detalhes internos na resposta final, salvo se o usuário pedir.',
].join('\n');

const toolDeclarations = [
  {
    name: 'describe_database',
    description: [
      'Retorna tabelas, colunas permitidas e chaves estrangeiras reais.',
      'Use sem tableNames para descobrir o catálogo; depois pode restringir a tabelas específicas.',
    ].join(' '),
    parameters: {
      type: 'OBJECT',
      properties: {
        tableNames: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Nomes exatos das tabelas desejadas.',
        },
      },
    },
  },
  {
    name: 'describe_table',
    description: 'Retorna colunas permitidas, domínio e relacionamentos reais de uma tabela específica.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tableName: {
          type: 'STRING',
          description: 'Nome exato da tabela.',
        },
      },
      required: ['tableName'],
    },
  },
  {
    name: 'search_entities',
    description: [
      'Procura uma entidade pelo nome e retorna tabela, id, nome e indicação de correspondência exata.',
      'Use antes de filtrar por nomes fornecidos pelo usuário.',
    ].join(' '),
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Somente o nome da entidade, sem palavras da pergunta.',
        },
        tableNames: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Tabelas candidatas, usando nomes exatos do catálogo.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_relationship_path',
    description: [
      'Encontra um caminho entre duas tabelas usando apenas chaves estrangeiras reais.',
      'Use antes de criar JOINs quando a relação não estiver explícita.',
    ].join(' '),
    parameters: {
      type: 'OBJECT',
      properties: {
        fromTable: { type: 'STRING' },
        toTable: { type: 'STRING' },
      },
      required: ['fromTable', 'toTable'],
    },
  },
  {
    name: 'execute_readonly_query',
    description: [
      'Valida e executa uma única consulta SELECT somente leitura.',
      'A ferramenta bloqueia tabelas, colunas e operações não autorizadas.',
    ].join(' '),
    parameters: {
      type: 'OBJECT',
      properties: {
        sql: {
          type: 'STRING',
          description: 'Uma única consulta SELECT, sem comentários e sem SELECT *.',
        },
      },
      required: ['sql'],
    },
  },
];

const asStringArray = (
  value: unknown,
): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter(
    (item): item is string =>
      typeof item === 'string' &&
      /^[a-z0-9_]+$/.test(item),
  );
};

const callTool = async (
  call: GeminiFunctionCall,
  tools: DatabaseAgentTools,
) => {
  const name = call.name;
  const args = call.args ?? {};

  if (name === 'describe_database') {
    return tools.describeDatabase(
      asStringArray(args.tableNames),
    );
  }

  if (name === 'search_entities') {
    if (typeof args.query !== 'string') {
      throw new Error('Nome da entidade não informado');
    }

    return tools.searchEntities(
      args.query,
      asStringArray(args.tableNames),
    );
  }

  if (name === 'describe_table') {
    if (
      typeof args.tableName !== 'string' ||
      !/^[a-z0-9_]+$/.test(args.tableName)
    ) {
      throw new Error('Nome de tabela inválido');
    }

    return tools.describeTable(args.tableName);
  }

  if (name === 'execute_readonly_query') {
    if (typeof args.sql !== 'string') {
      throw new Error('SQL não informada');
    }

    return tools.executeSelect(args.sql);
  }

  if (name === 'find_relationship_path') {
    if (
      typeof args.fromTable !== 'string' ||
      typeof args.toTable !== 'string'
    ) {
      throw new Error('Tabelas de origem e destino não informadas');
    }

    return tools.findRelationshipPath(
      args.fromTable,
      args.toTable,
    );
  }

  throw new Error(`Ferramenta desconhecida: ${name ?? 'sem nome'}`);
};

const requestGemini = async (
  apiKey: string,
  contents: GeminiContent[],
): Promise<GeminiContent> => {
  try {
    const now = Date.now();

    if (geminiBlockedUntil > now) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((geminiBlockedUntil - now) / 1000),
      );

      throw new DatabaseAgentUnavailableError(
        'GEMINI_RATE_LIMIT',
        'Gemini temporariamente bloqueado após atingir o limite',
        retryAfterSeconds,
      );
    }

    const response = await fetch(
      `${apiUrl}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents,
          tools: [{ functionDeclarations: toolDeclarations }],
          toolConfig: {
            functionCallingConfig: {
              mode: 'AUTO',
            },
          },
          generationConfig,
        }),
      },
    );

    if (response.ok) {
      const payload = await response.json() as GeminiResponse;
      const content = payload.candidates?.[0]?.content;

      if (!content?.parts?.length) {
        const reason =
          payload.promptFeedback?.blockReason ??
          payload.candidates?.[0]?.finishReason ??
          'resposta vazia';

        throw new Error(`Gemini não respondeu: ${reason}`);
      }

      return {
        role: 'model',
        parts: content.parts,
      };
    }

    if (response.status === 429) {
      const headerSeconds = Number(
        response.headers.get('retry-after'),
      );
      const retryAfterSeconds =
        Number.isFinite(headerSeconds) && headerSeconds >= 0
          ? Math.ceil(headerSeconds)
          : configuredRateLimitCooldown();
      geminiBlockedUntil = Date.now() + retryAfterSeconds * 1000;

      throw new DatabaseAgentUnavailableError(
        'GEMINI_RATE_LIMIT',
        'Limite temporário do Gemini atingido; tente novamente em aproximadamente um minuto',
        retryAfterSeconds,
      );
    }

    if (response.status === 404) {
      throw new DatabaseAgentUnavailableError(
        'GEMINI_MODEL_UNAVAILABLE',
        'Modelo Gemini temporariamente indisponível',
      );
    }

    throw new DatabaseAgentUnavailableError(
      'GEMINI_UNAVAILABLE',
      `Gemini indisponível (HTTP ${response.status})`,
    );
  } catch (error) {
    if (error instanceof DatabaseAgentUnavailableError) {
      throw error;
    }

    if (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        error.name === 'TimeoutError')
    ) {
      throw new DatabaseAgentUnavailableError(
        'GEMINI_TIMEOUT',
        'Gemini não respondeu dentro do prazo seguro',
      );
    }

    throw new DatabaseAgentUnavailableError(
      'GEMINI_UNAVAILABLE',
      'Não foi possível acessar o Gemini',
    );
  }
};

export const runGeminiDatabaseAgent = async (
  rawQuestion: string,
  tools: DatabaseAgentTools,
  availableTables: readonly string[] = [],
): Promise<DatabaseAgentResult> => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada');
  }

  const question = rawQuestion.trim();
  const startedAt = performance.now();
  const contents: GeminiContent[] = [
    {
      role: 'user',
      parts: [{
        text: [
          `Pergunta: ${question}`,
          availableTables.length
            ? `Tabelas disponíveis: ${availableTables.join(', ')}`
            : '',
        ].filter(Boolean).join('\n'),
      }],
    },
  ];

  const toolCalls: DatabaseAgentResult['toolCalls'] = [];
  const resolvedEntities: Array<{
    table: string;
    id: string | number;
    name: string;
  }> = [];
  let generatedSql = '';
  let queryResult: unknown;

  for (
    let iteration = 1;
    iteration <= maximumIterations;
    iteration += 1
  ) {
    const modelContent = await requestGemini(
      apiKey,
      contents,
    );

    const functionCalls = (modelContent.parts ?? [])
      .map(part => part.functionCall)
      .filter(
        (call): call is GeminiFunctionCall =>
          Boolean(call?.name),
      );

    if (functionCalls.length === 0) {
      const answer = (modelContent.parts ?? [])
        .map(part => part.text ?? '')
        .join('\n')
        .trim();

      if (!answer) {
        throw new Error('Gemini retornou resposta final vazia');
      }

      if (queryResult === undefined) {
        contents.push(modelContent);
        contents.push({
          role: 'user',
          parts: [{
            text: 'Use as ferramentas e execute uma consulta antes de responder.',
          }],
        });
        continue;
      }

      return {
        answer: answer.replace(/\s*\n+\s*/g, ' ').trim(),
        provider: 'gemini',
        model,
        iterations: iteration,
        toolCalls,
        generatedSql,
        queryResult,
        modelRequests: iteration,
        durationMs: Math.round(performance.now() - startedAt),
      };
    }

    contents.push(modelContent);

    const responseParts: GeminiPart[] = [];

    for (const call of functionCalls) {
      const name = call.name as string;

      try {
        if (
          name === 'execute_readonly_query' &&
          typeof call.args?.sql === 'string'
        ) {
          const sql = call.args.sql;
          const ignoredEntity = resolvedEntities.find(entity =>
            sql.toLocaleLowerCase('pt-BR').includes(
              entity.name.toLocaleLowerCase('pt-BR'),
            ),
          );

          if (ignoredEntity) {
            throw new Error([
              `Entidade já resolvida: ${ignoredEntity.table}.id = ${ignoredEntity.id}.`,
              'Não use o nome resolvido em LIKE ou igualdade textual;',
              'refaça a consulta filtrando pelo ID informado.',
            ].join(' '));
          }
        }

        const result = await callTool(call, tools);

        if (name === 'search_entities' && Array.isArray(result)) {
          for (const item of result) {
            if (
              typeof item === 'object' &&
              item !== null &&
              'exact' in item &&
              item.exact === true &&
              'table' in item &&
              typeof item.table === 'string' &&
              'id' in item &&
              (typeof item.id === 'string' ||
                typeof item.id === 'number') &&
              'name' in item &&
              typeof item.name === 'string'
            ) {
              resolvedEntities.push({
                table: item.table,
                id: item.id,
                name: item.name,
              });
            }
          }
        }

        if (
          name === 'execute_readonly_query' &&
          typeof call.args?.sql === 'string'
        ) {
          generatedSql = call.args.sql;
          queryResult = result;
        }

        toolCalls.push({ name, successful: true });
        responseParts.push({
          functionResponse: {
            ...(call.id ? { id: call.id } : {}),
            name,
            response: {
              ok: true,
              result,
            },
          },
        });
      } catch (error) {
        toolCalls.push({ name, successful: false });
        responseParts.push({
          functionResponse: {
            ...(call.id ? { id: call.id } : {}),
            name,
            response: {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Ferramenta recusada',
            },
          },
        });
      }
    }

    contents.push({
      role: 'user',
      parts: responseParts,
    });
  }

  throw new Error(
    'O agente excedeu o limite seguro de etapas',
  );
};
