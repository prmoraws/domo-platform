import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runCustomerServiceAgent,
} from './customer-service-agent.js';

test('rejeita mensagem vazia sem chamar Gemini', async () => {
  await assert.rejects(
    () => runCustomerServiceAgent({
      message: '   ',
    }),
    /Mensagem vazia/,
  );
});

test('resolve saudação inicial sem chamar Gemini', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  process.env.GEMINI_API_KEY = 'test-key';

  let fetchCalled = false;

  globalThis.fetch = async () => {
    fetchCalled = true;

    throw new Error(
      'Gemini não deveria ser chamado para saudação',
    );
  };

  try {
    const result = await runCustomerServiceAgent({
      message: 'Olá',
      firstInteraction: true,
      isHoliday: false,
      localDate: '2026-09-04',
      localTime: '19:30',
    });

    assert.equal(
      result.answer,
      [
        'Boa noite!',
        'Programa Momento do Presidiário. Em que posso ajudar?',
      ].join('\n'),
    );

    assert.equal(
      result.provider,
      'deterministic',
    );

    assert.equal(
      result.model,
      'deterministic-rule',
    );

    assert.equal(
      result.durationMs,
      0,
    );

    assert.equal(
      fetchCalled,
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;

    if (originalKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalKey;
    }
  }
});

test('usa Gemini para pergunta aberta sem ferramentas de banco', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  process.env.GEMINI_API_KEY = 'test-key';

  let capturedBody = '';
  let fetchCalled = false;

  globalThis.fetch = async (_url, init) => {
    fetchCalled = true;
    capturedBody = String(init?.body ?? '');

    return new Response(
      JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text:
                'A UNP é um trabalho de assistência espiritual.',
            }],
          },
        }],
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    );
  };

  try {
    // Pergunta deliberadamente aberta e fora das
    // regras determinísticas.
    const result = await runCustomerServiceAgent({
      message:
        'Conte um pouco sobre como surgiu o trabalho da Universal nos presídios',
      firstInteraction: false,
      isHoliday: false,
      localDate: '2026-09-04',
      localTime: '19:30',
    });

    assert.equal(fetchCalled, true);

    assert.equal(
      result.provider,
      'gemini',
    );

    assert.notEqual(
      result.model,
      'deterministic-rule',
    );

    assert.match(
      capturedBody,
      /Momento do Presidiário/,
    );

    assert.match(
      capturedBody,
      /71\) 99185-6704/,
    );

    assert.doesNotMatch(
      capturedBody,
      /execute_readonly_query/,
    );

    assert.doesNotMatch(
      capturedBody,
      /describe_database/,
    );
  } finally {
    globalThis.fetch = originalFetch;

    if (originalKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalKey;
    }
  }
});

test('não envia mais de dez mensagens anteriores ao Gemini', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  process.env.GEMINI_API_KEY = 'test-key';

  let body:
    | {
        contents?: unknown[];
      }
    | undefined;

  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(
      String(init?.body ?? '{}'),
    );

    return new Response(
      JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: 'Resposta de teste.',
            }],
          },
        }],
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    );
  };

  try {
    await runCustomerServiceAgent({
      message:
        'Gostaria de entender melhor esse trabalho de assistência',
      history: Array.from(
        { length: 20 },
        (_, index) => ({
          role:
            index % 2 === 0
              ? 'user' as const
              : 'assistant' as const,
          text: `Mensagem ${index}`,
        }),
      ),
    });

    // 10 históricos + mensagem atual.
    assert.equal(
      body?.contents?.length,
      11,
    );
  } finally {
    globalThis.fetch = originalFetch;

    if (originalKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalKey;
    }
  }
});

test('encerramento silencioso não chama Gemini', async () => {
  const originalFetch = globalThis.fetch;

  let fetchCalled = false;

  globalThis.fetch = async () => {
    fetchCalled = true;

    throw new Error(
      'Gemini não deveria ser chamado'
    );
  };

  try {
    const result =
      await runCustomerServiceAgent({
        message: 'Amém',
        firstInteraction: false,
      });

    assert.equal(
      result.provider,
      'deterministic',
    );

    assert.equal(
      result.silent,
      true,
    );

    assert.equal(
      result.answer,
      '',
    );

    assert.equal(
      fetchCalled,
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
