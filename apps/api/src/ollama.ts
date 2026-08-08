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

export const selectRelevantTables = async (
  question: string,
  availableTables: readonly string[],
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
              '',
              'TABELAS DISPONÍVEIS:',
              availableTables.join(', '),
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

  const selectedTables = [
    ...new Set(
      parsed.tables.filter(
        (table): table is string =>
          typeof table === 'string' &&
          allowedTables.has(table),
      ),
    ),
  ].slice(0, 5);

  if (selectedTables.length === 0) {
    throw new Error(
      'Nenhuma tabela relevante foi identificada',
    );
  }

  return selectedTables;
};

export const generateDatabaseQuery = async (
  question: string,
  databaseSchema: string,
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
              '',
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

  const sql = generated.sql
    .trim()
    .replace(/;\s*$/, '');

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
): Promise<string> => {
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
              'Use somente os dados fornecidos.',
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
    throw new Error(
      `Ollama retornou HTTP ${response.status}`,
    );
  }

  const ollama =
    await response.json() as OllamaResponse;

  const content = ollama.message?.content;

  if (!content) {
    throw new Error(
      'Ollama não produziu uma resposta',
    );
  }

  const parsed = JSON.parse(content) as {
    answer?: unknown;
  };

  if (
    typeof parsed.answer !== 'string' ||
    !parsed.answer.trim()
  ) {
    throw new Error(
      'Ollama retornou resposta inválida',
    );
  }

  return parsed.answer.trim();
};