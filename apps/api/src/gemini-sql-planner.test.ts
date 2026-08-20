import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateGeminiSqlPlan,
} from './gemini-sql-planner.js';

test('gera um plano SQL em uma única chamada', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              sql: 'SELECT nome FROM blocos',
              explanation: 'Lista os blocos.',
            }),
          }],
        },
      }],
    }), { status: 200 });
  };

  try {
    const plan = await generateGeminiSqlPlan(
      'Liste os blocos',
      'blocos(id, nome)',
    );

    assert.equal(calls, 1);
    assert.equal(plan.sql, 'SELECT nome FROM blocos');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('identifica imediatamente o limite 429', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(
    'quota exceeded',
    { status: 429 },
  );

  try {
    await assert.rejects(
      generateGeminiSqlPlan(
        'Liste os blocos',
        'blocos(id, nome)',
      ),
      /GEMINI_RATE_LIMIT/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('identifica modelo indisponível sem esperar', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(
    'model unavailable',
    { status: 404 },
  );

  try {
    await assert.rejects(
      generateGeminiSqlPlan(
        'Liste os blocos',
        'blocos(id, nome)',
      ),
      /GEMINI_MODEL_UNAVAILABLE/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});
