export interface GeminiSqlPlan {
  sql: string;
  explanation: string;
  model: string;
}

interface GeminiPlannerResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

const apiUrl =
  process.env.GEMINI_API_URL ??
  'https://generativelanguage.googleapis.com/v1beta';

const plannerModel =
  process.env.GEMINI_PLANNER_MODEL ??
  process.env.GEMINI_MODEL ??
  'gemini-2.5-flash';

export const generateGeminiSqlPlan = async (
  question: string,
  databaseSchema: string,
): Promise<GeminiSqlPlan> => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada');
  }

  const response = await fetch(
    `${apiUrl}/models/${encodeURIComponent(plannerModel)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: [
              'Você é o planejador SQL da plataforma DOMO.',
              'Converta a pergunta em uma única consulta SELECT para MariaDB.',
              'Use exclusivamente as tabelas, colunas e relações do esquema.',
              'Nunca invente identificadores.',
              'Nunca use SELECT *, comentários, UNION ou ponto e vírgula.',
              'Nunca consulte senhas, tokens ou credenciais.',
              'Nunca aplique filtros que não foram solicitados.',
              'Diferencie o campo solicitado da entidade usada como filtro.',
              'Para nomes, filtre a coluna nome da entidade correta.',
              'Use as chaves estrangeiras informadas para JOINs.',
              'Use aliases descritivos em português sem espaços.',
              'Não adicione LIMIT; o gateway seguro fará isso.',
            ].join('\n'),
          }],
        },
        contents: [{
          role: 'user',
          parts: [{
            text: [
              `PERGUNTA:\n${question}`,
              '',
              'ESQUEMA AUTORIZADO:',
              databaseSchema,
            ].join('\n'),
          }],
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
          thinkingConfig: {
            thinkingLevel: 'minimal',
          },
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              sql: { type: 'STRING' },
              explanation: { type: 'STRING' },
            },
            required: ['sql', 'explanation'],
          },
        },
      }),
    },
  );

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('GEMINI_RATE_LIMIT');
    }

    if (response.status === 404) {
      throw new Error('GEMINI_MODEL_UNAVAILABLE');
    }

    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Gemini retornou HTTP ${response.status}: ${detail}`,
    );
  }

  const payload =
    await response.json() as GeminiPlannerResponse;
  const content =
    payload.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error('Gemini não retornou um plano SQL');
  }

  let parsed: {
    sql?: unknown;
    explanation?: unknown;
  };

  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch (error) {
    const finishReason =
      payload.candidates?.[0]?.finishReason ??
      'desconhecido';

    throw new Error(
      [
        'Gemini retornou JSON inválido',
        `(motivo de término: ${finishReason})`,
      ].join(' '),
      {
        cause: error,
      },
    );
  }

  if (
    typeof parsed.sql !== 'string' ||
    typeof parsed.explanation !== 'string'
  ) {
    throw new Error('Gemini retornou plano SQL inválido');
  }

  return {
    sql: parsed.sql.trim().replace(/;\s*$/, ''),
    explanation: parsed.explanation.trim(),
    model: plannerModel,
  };
};
