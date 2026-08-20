import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DatabaseAgentUnavailableError,
  runGeminiDatabaseAgent,
} from './gemini-database-agent.js';

const response = (parts: unknown[]) => new Response(
  JSON.stringify({
    candidates: [{
      content: {
        role: 'model',
        parts,
      },
    }],
  }),
  {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  },
);

test(
  'usa catálogo, resolve entidade e executa SELECT seguro',
  async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    const replies = [
      response([{
          functionCall: {
            id: 'call-describe',
            name: 'describe_database',
          args: {
            tableNames: ['pastor_unps', 'blocos'],
          },
        },
      }]),
      response([{
          functionCall: {
            id: 'call-search',
            name: 'search_entities',
          args: {
            query: 'Alagoinhas',
            tableNames: ['blocos'],
          },
        },
      }]),
      response([{
          functionCall: {
            id: 'call-query',
            name: 'execute_readonly_query',
          args: {
            sql: [
              'SELECT pastor_unps.nome AS pastor',
              'FROM pastor_unps',
              'JOIN blocos ON pastor_unps.bloco_id = blocos.id',
              'WHERE blocos.id = 1',
              'LIMIT 20',
            ].join(' '),
          },
        },
      }]),
      response([{
        text: 'O pastor do bloco Alagoinhas é João.',
      }]),
    ];

    const originalFetch = globalThis.fetch;
      const requestBodies: Array<Record<string, unknown>> = [];

      globalThis.fetch = async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        const next = replies.shift();

      if (!next) {
        throw new Error('Chamada inesperada');
      }

      return next;
    };

    let executedSql = '';

    try {
      const result = await runGeminiDatabaseAgent(
        'Qual é o pastor do bloco Alagoinhas?',
        {
          describeDatabase: async () => ({
            tables: ['pastor_unps', 'blocos'],
          }),
          describeTable: async () => ({}),
          findRelationshipPath: async () => [],
          searchEntities: async () => [{
            table: 'blocos',
            id: 1,
            name: 'Alagoinhas',
            exact: true,
          }],
          executeSelect: async sql => {
            executedSql = sql;
            return {
              rows: [{ pastor: 'João' }],
            };
          },
        },
      );

      assert.match(executedSql, /WHERE blocos\.id = 1/);
      assert.equal(
        result.answer,
        'O pastor do bloco Alagoinhas é João.',
      );
      assert.equal(result.iterations, 4);
      const secondRequest = requestBodies[1] as {
        contents?: Array<{
          parts?: Array<{
            functionResponse?: { id?: string };
          }>;
        }>;
      };
      assert.equal(
        secondRequest.contents?.at(-1)
          ?.parts?.[0]?.functionResponse?.id,
        'call-describe',
      );
      assert.deepEqual(
        result.toolCalls.map(call => call.name),
        [
          'describe_database',
          'search_entities',
          'execute_readonly_query',
        ],
      );
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.GEMINI_API_KEY;
    }
  },
);

test('descreve tabela específica e mede chamadas do modelo', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  const replies = [
    response([{
      functionCall: {
        name: 'describe_table',
        args: { tableName: 'pessoas' },
      },
    }]),
    response([{
      functionCall: {
        name: 'execute_readonly_query',
        args: { sql: 'SELECT COUNT(id) AS total FROM pessoas' },
      },
    }]),
    response([{ text: 'Existem 10 pessoas cadastradas.' }]),
  ];
  let describedTable = '';

  globalThis.fetch = async () => {
    const next = replies.shift();
    if (!next) throw new Error('Chamada inesperada');
    return next;
  };

  try {
    const result = await runGeminiDatabaseAgent(
      'Quantas pessoas estão cadastradas?',
      {
        describeDatabase: async () => ({}),
        describeTable: async tableName => {
          describedTable = tableName;
          return { table: { name: tableName } };
        },
        findRelationshipPath: async () => [],
        searchEntities: async () => [],
        executeSelect: async () => ({ rows: [{ total: 10 }] }),
      },
    );

    assert.equal(describedTable, 'pessoas');
    assert.equal(result.modelRequests, 3);
    assert.ok(result.durationMs >= 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('classifica limite 429 sem expor resposta bruta', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_RATE_LIMIT_COOLDOWN_SECONDS = '0';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    'detalhe interno que não deve vazar',
    { status: 429 },
  );

  try {
    await assert.rejects(
      runGeminiDatabaseAgent('Quantas igrejas existem?', {
        describeDatabase: async () => ({}),
        describeTable: async () => ({}),
        findRelationshipPath: async () => [],
        searchEntities: async () => [],
        executeSelect: async () => ({}),
      }),
      (error: unknown) =>
        error instanceof DatabaseAgentUnavailableError &&
        error.code === 'GEMINI_RATE_LIMIT' &&
        !error.message.includes('detalhe interno'),
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_RATE_LIMIT_COOLDOWN_SECONDS;
  }
});

test('classifica modelo Gemini indisponível', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });

  try {
    await assert.rejects(
      runGeminiDatabaseAgent('Quantas igrejas existem?', {
        describeDatabase: async () => ({}),
        describeTable: async () => ({}),
        findRelationshipPath: async () => [],
        searchEntities: async () => [],
        executeSelect: async () => ({}),
      }),
      (error: unknown) =>
        error instanceof DatabaseAgentUnavailableError &&
        error.code === 'GEMINI_MODEL_UNAVAILABLE',
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('classifica resposta JSON inválida do provedor', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{json-invalido', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    await assert.rejects(
      runGeminiDatabaseAgent('Quantas igrejas existem?', {
        describeDatabase: async () => ({}),
        describeTable: async () => ({}),
        findRelationshipPath: async () => [],
        searchEntities: async () => [],
        executeSelect: async () => ({}),
      }),
      (error: unknown) =>
        error instanceof DatabaseAgentUnavailableError &&
        error.code === 'GEMINI_UNAVAILABLE',
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('classifica timeout do provedor', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error('tempo excedido');
    error.name = 'TimeoutError';
    throw error;
  };

  try {
    await assert.rejects(
      runGeminiDatabaseAgent('Quantas igrejas existem?', {
        describeDatabase: async () => ({}),
        describeTable: async () => ({}),
        findRelationshipPath: async () => [],
        searchEntities: async () => [],
        executeSelect: async () => ({}),
      }),
      (error: unknown) =>
        error instanceof DatabaseAgentUnavailableError &&
        error.code === 'GEMINI_TIMEOUT',
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('permite ao agente corrigir consulta recusada', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  const replies = [
    response([{
      functionCall: {
        name: 'execute_readonly_query',
        args: { sql: 'SELECT coluna_inventada FROM igrejas' },
      },
    }]),
    response([{
      functionCall: {
        name: 'execute_readonly_query',
        args: { sql: 'SELECT COUNT(id) AS total FROM igrejas' },
      },
    }]),
    response([{ text: 'Existem 646 igrejas cadastradas.' }]),
  ];

  globalThis.fetch = async () => {
    const next = replies.shift();
    if (!next) throw new Error('Chamada inesperada');
    return next;
  };

  try {
    const result = await runGeminiDatabaseAgent(
      'Quantas igrejas existem?',
      {
        describeDatabase: async () => ({}),
        describeTable: async () => ({}),
        findRelationshipPath: async () => [],
        searchEntities: async () => [],
        executeSelect: async sql => {
          if (sql.includes('coluna_inventada')) {
            throw new Error('Coluna não autorizada');
          }
          return { rows: [{ total: 646 }] };
        },
      },
    );

    assert.equal(result.answer, 'Existem 646 igrejas cadastradas.');
    assert.deepEqual(result.toolCalls, [
      { name: 'execute_readonly_query', successful: false },
      { name: 'execute_readonly_query', successful: true },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('obriga uso do ID de entidade resolvida', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  const replies = [
    response([{
      functionCall: {
        name: 'search_entities',
        args: { query: 'Alagoinhas', tableNames: ['blocos'] },
      },
    }]),
    response([{
      functionCall: {
        name: 'execute_readonly_query',
        args: {
          sql: "SELECT COUNT(pessoas.id) AS total FROM pessoas JOIN blocos ON pessoas.bloco_id = blocos.id WHERE blocos.nome LIKE '%Alagoinhas%'",
        },
      },
    }]),
    response([{
      functionCall: {
        name: 'execute_readonly_query',
        args: {
          sql: 'SELECT COUNT(pessoas.id) AS total FROM pessoas WHERE pessoas.bloco_id = 7',
        },
      },
    }]),
    response([{ text: 'Existem 12 pessoas no bloco Alagoinhas.' }]),
  ];
  globalThis.fetch = async () => {
    const next = replies.shift();
    if (!next) throw new Error('Chamada inesperada');
    return next;
  };
  const executed: string[] = [];

  try {
    const result = await runGeminiDatabaseAgent(
      'Quantas pessoas pertencem ao bloco Alagoinhas?',
      {
        describeDatabase: async () => ({}),
        describeTable: async () => ({}),
        findRelationshipPath: async () => [],
        searchEntities: async () => [{
          table: 'blocos', id: 7, name: 'Alagoinhas', exact: true,
        }],
        executeSelect: async sql => {
          executed.push(sql);
          return { rows: [{ total: 12 }] };
        },
      },
    );

    assert.deepEqual(executed, [
      'SELECT COUNT(pessoas.id) AS total FROM pessoas WHERE pessoas.bloco_id = 7',
    ]);
    assert.equal(result.toolCalls.at(1)?.successful, false);
    assert.equal(result.answer, 'Existem 12 pessoas no bloco Alagoinhas.');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test(
  'não aceita resposta sem consulta executada',
  async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response([{
      text: 'Resposta inventada sem consultar.',
    }]);

    try {
      await assert.rejects(
        runGeminiDatabaseAgent(
          'Quantas igrejas existem?',
          {
            describeDatabase: async () => ({}),
            describeTable: async () => ({}),
            findRelationshipPath: async () => [],
            searchEntities: async () => [],
            executeSelect: async () => ({}),
          },
        ),
        /excedeu o limite seguro/,
      );
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.GEMINI_API_KEY;
    }
  },
);
