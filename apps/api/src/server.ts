import { timingSafeEqual } from 'node:crypto';
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

import {
  closeDatabase,
  countTableRecords,
  getDatabaseCatalog,
  getDatabaseStatus,
  getDatabaseSummary,
  executeSafeSelect,
} from './database.js';

import {
  DatabaseAgentUnavailableError,
  getGeminiCircuitStatus,
  runGeminiDatabaseAgent,
} from './gemini-database-agent.js';

import {
  runCustomerServiceAgent,
  type CustomerServiceHistoryItem,
} from './customer-service-agent.js';

import {
  createDatabaseAgentTools,
  getQueryableTableNames,
} from './database-agent-tools.js';

import {
  interpretDatabaseQuestion,
} from './whatsapp-query-interpreter.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'request.headers.authorization',
        'headers.authorization',
      ],
      censor: '[REDACTED]',
    },
  },
});

const internalToken = process.env.API_INTERNAL_TOKEN;

if (!internalToken || internalToken.length < 32) {
  throw new Error(
    'API_INTERNAL_TOKEN precisa estar configurado com pelo menos 32 caracteres',
  );
}

const tokenIsValid = (receivedToken: string): boolean => {
  const received = Buffer.from(receivedToken);
  const expected = Buffer.from(internalToken);

  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(received, expected);
};

const requireInternalAuthentication = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    return reply.code(401).send({
      error: 'unauthorized',
      message: 'Token de acesso não informado',
    });
  }

  const receivedToken = authorization.slice('Bearer '.length);

  if (!tokenIsValid(receivedToken)) {
    return reply.code(401).send({
      error: 'unauthorized',
      message: 'Token de acesso inválido',
    });
  }
};

app.get('/', async () => {
  return {
    name: 'DOMO API',
    version: '0.1.0',
    documentation: '/health',
  };
});

app.get(
  '/health',
  { logLevel: 'silent' },
  async () => ({
    status: 'ok',
    service: 'domo-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }),
);

app.get(
  '/internal/status',
  {
    preHandler: requireInternalAuthentication,
  },
  async () => {
    return {
      status: 'ok',
      service: 'domo-api',
      access: 'internal',
      timestamp: new Date().toISOString(),
    };
  },
);

app.get(
  '/internal/assistant/status',
  {
    preHandler: requireInternalAuthentication,
  },
  async () => ({
    status: 'ok',
    service: 'domo-api',
    provider: 'gemini',
    model:
      process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    circuitBreaker: getGeminiCircuitStatus(),
    timestamp: new Date().toISOString(),
  }),
);

app.get(
  '/internal/database/status',
  {
    preHandler: requireInternalAuthentication,
  },
  async (request, reply) => {
    try {
      const database = await getDatabaseStatus();

      return {
        status: 'ok',
        service: 'domo-api',
        database,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      request.log.error(
        { error },
        'Falha ao verificar a conexão com o MySQL',
      );

      return reply.code(503).send({
        status: 'error',
        service: 'domo-api',
        error: 'database_unavailable',
        message: 'Banco de dados indisponível',
        timestamp: new Date().toISOString(),
      });
    }
  },
);

app.get(
  '/internal/database/summary',
  {
    preHandler: requireInternalAuthentication,
  },
  async (request, reply) => {
    try {
      const summary = await getDatabaseSummary();

      return {
        status: 'ok',
        service: 'domo-api',
        database: summary,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      request.log.error(
        { error },
        'Falha ao consultar o resumo do MariaDB',
      );

      return reply.code(503).send({
        status: 'error',
        error: 'database_unavailable',
        message: 'Não foi possível consultar o banco',
      });
    }
  },
);


app.get(
  '/internal/database/catalog',
  {
    preHandler: requireInternalAuthentication,
  },
  async (request, reply) => {
    try {
      const database = await getDatabaseCatalog();

      return {
        status: 'ok',
        service: 'domo-api',
        database,
      };
    } catch (error) {
      request.log.error(
        { error },
        'Falha ao gerar catálogo do banco',
      );

      return reply.code(503).send({
        status: 'error',
        service: 'domo-api',
        error: 'database_catalog_unavailable',
        message: 'Catálogo do banco indisponível',
      });
    }
  },
);

interface DatabaseQueryBody {
  operation?: unknown;
  table?: unknown;
}

app.post<{
  Body: DatabaseQueryBody;
}>(
  '/internal/database/query',
  {
    preHandler: requireInternalAuthentication,
  },
  async (request, reply) => {
    const {
      operation,
      table,
    } = request.body ?? {};

    if (operation !== 'count_records') {
      return reply.code(400).send({
        status: 'error',
        error: 'operation_not_allowed',
        message: 'Operação de consulta não autorizada',
      });
    }

    if (typeof table !== 'string') {
      return reply.code(400).send({
        status: 'error',
        error: 'invalid_table',
        message: 'Tabela não informada corretamente',
      });
    }

    try {
      const result = await countTableRecords(table);

      return {
        status: 'ok',
        service: 'domo-api',
        result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      request.log.warn(
        {
          error,
          operation,
          table,
        },
        'Consulta ao banco recusada',
      );

      return reply.code(400).send({
        status: 'error',
        error: 'query_refused',
        message:
          error instanceof Error
            ? error.message
            : 'Consulta recusada',
      });
    }
  },
);

interface WhatsAppInterpretBody {
  question?: unknown;
}

app.post<{
  Body: WhatsAppInterpretBody;
}>(
  '/internal/whatsapp/interpret',
  {
    preHandler: requireInternalAuthentication,
  },
  async (request, reply) => {
    try {
      const query = interpretDatabaseQuestion(
        request.body?.question,
      );

      return {
        status: 'ok',
        service: 'domo-api',
        query,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      request.log.info(
        { error },
        'Pergunta do WhatsApp não reconhecida',
      );

      return reply.code(400).send({
        status: 'error',
        error: 'question_not_recognized',
        message:
          error instanceof Error
            ? error.message
            : 'Pergunta não reconhecida',
      });
    }
  },
);

interface SafeSelectBody {
  sql?: unknown;
}

app.post<{
  Body: SafeSelectBody;
}>(
  '/internal/database/select',
  {
    preHandler: requireInternalAuthentication,
  },
  async (request, reply) => {
    try {
      const result = await executeSafeSelect(
        request.body?.sql,
      );

      return {
        status: 'ok',
        service: 'domo-api',
        result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      request.log.warn(
        { error },
        'Consulta SQL segura recusada',
      );

      return reply.code(400).send({
        status: 'error',
        error: 'safe_query_refused',
        message:
          error instanceof Error
            ? error.message
            : 'Consulta recusada',
      });
    }
  },
);


interface CustomerServiceQueryBody {
  message?: unknown;
  firstInteraction?: unknown;
  isHoliday?: unknown;
  localDate?: unknown;
  localTime?: unknown;
  history?: unknown;
}

app.post<{
  Body: CustomerServiceQueryBody;
}>(
  '/internal/customer-service/query',
  {
    preHandler: requireInternalAuthentication,
  },
  async (request, reply) => {
    const rawMessage = request.body?.message;

    if (
      typeof rawMessage !== 'string' ||
      rawMessage.trim().length < 1 ||
      rawMessage.length > 2000
    ) {
      return reply.code(400).send({
        status: 'error',
        error: 'invalid_message',
        message: 'Mensagem inválida',
      });
    }

    const rawHistory = request.body?.history;

    let history: CustomerServiceHistoryItem[] = [];

    if (Array.isArray(rawHistory)) {
      history = rawHistory
        .slice(-10)
        .filter((item): item is {
          role: 'user' | 'assistant';
          text: string;
        } => (
          typeof item === 'object' &&
          item !== null &&
          (
            (item as { role?: unknown }).role === 'user' ||
            (item as { role?: unknown }).role === 'assistant'
          ) &&
          typeof (item as { text?: unknown }).text === 'string'
        ))
        .map((item) => ({
          role: item.role,
          text: item.text.slice(0, 2000),
        }));
    }

    try {
      const customerServiceInput = {
        message: rawMessage.trim(),
        firstInteraction:
          request.body?.firstInteraction === true,
        isHoliday:
          request.body?.isHoliday === true,
        history,
        ...(typeof request.body?.localDate === 'string'
          ? {
              localDate:
                request.body.localDate.slice(0, 10),
            }
          : {}),
        ...(typeof request.body?.localTime === 'string'
          ? {
              localTime:
                request.body.localTime.slice(0, 5),
            }
          : {}),
      };

      const agent = await runCustomerServiceAgent(
        customerServiceInput,
      );

      request.log.info(
        {
          event: 'customer_service_query_completed',
          requestId: request.id,
          provider: agent.provider,
          model: agent.model,
          durationMs: agent.durationMs,
          successful: true,
        },
        'Atendimento virtual concluído',
      );

      return {
        status: 'ok',
        service: 'domo-api',
        assistant: {
          answer: agent.answer,
          provider: agent.provider,
          model: agent.model,
          durationMs: agent.durationMs,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      request.log.warn(
        {
          event: 'customer_service_query_failed',
          requestId: request.id,
          successful: false,
        },
        'Atendimento virtual indisponível',
      );

      return reply.code(200).send({
        status: 'temporarily_unavailable',
        service: 'domo-api',
        retryable: true,
        assistant: {
          answer: [
            'No momento não consegui concluir essa orientação.',
            'Por favor, tente novamente em alguns minutos.',
            'Se precisar de atendimento espiritual,',
            'você também pode falar com um pastor pelo telefone',
            '(71) 3432-9119.',
          ].join(' '),
          provider: 'fallback',
          model: 'customer-service-fallback',
          durationMs: 0,
        },
        timestamp: new Date().toISOString(),
      });
    }
  },
);

interface AssistantDatabaseQueryBody {
  question?: unknown;
}

app.post<{
  Body: AssistantDatabaseQueryBody;
}>(
  '/internal/assistant/query',
  {
    preHandler: requireInternalAuthentication,
  },
  async (request, reply) => {
    const rawQuestion =
      request.body?.question;

    if (
      typeof rawQuestion !== 'string' ||
      rawQuestion.trim().length < 3 ||
      rawQuestion.length > 500
    ) {
      return reply.code(400).send({
        status: 'error',
        error: 'invalid_question',
        message: 'Pergunta inválida',
      });
    }

    const question = rawQuestion.trim();

    try {
      const availableTables = await getQueryableTableNames();
      const agent = await runGeminiDatabaseAgent(
        question,
        createDatabaseAgentTools(),
        availableTables,
      );

      request.log.info(
        {
          event: 'assistant_query_completed',
          requestId: request.id,
          provider: agent.provider,
          model: agent.model,
          durationMs: agent.durationMs,
          modelRequests: agent.modelRequests,
          iterations: agent.iterations,
          toolCalls: agent.toolCalls,
          successful: true,
        },
        'Consulta do assistente concluída',
      );

      return {
        status: 'ok',
        service: 'domo-api',
        assistant: {
          question,
          answer: agent.answer,
          provider: agent.provider,
          model: agent.model,
          iterations: agent.iterations,
          modelRequests: agent.modelRequests,
          durationMs: agent.durationMs,
          toolCalls: agent.toolCalls,
          generatedSql: agent.generatedSql,
        },
        result: agent.queryResult,
        timestamp:
          new Date().toISOString(),
      };
    } catch (error) {
      request.log.warn(
        {
          event: 'assistant_query_failed',
          requestId: request.id,
          errorCode:
            error instanceof DatabaseAgentUnavailableError
              ? error.code
              : 'AGENT_QUERY_REFUSED',
          retryAfterSeconds:
            error instanceof DatabaseAgentUnavailableError
              ? error.retryAfterSeconds
              : undefined,
          successful: false,
        },
        'Consulta do assistente recusada',
      );

      if (
        error instanceof DatabaseAgentUnavailableError
      ) {
        return reply.code(200).send({
          status: 'temporarily_unavailable',
          service: 'domo-api',
          retryable: true,
          retryAfterSeconds: error.retryAfterSeconds,
          assistant: {
            question,
            answer: [
              'O serviço de consultas atingiu um limite temporário.',
              'Por favor, tente novamente mais tarde.',
            ].join(' '),
          },
          timestamp: new Date().toISOString(),
        });
      }

      return reply.code(400).send({
        status: 'error',
        error: 'assistant_query_refused',
        message: 'Não foi possível concluir a consulta com segurança',
      });
    }
  },
);

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? '0.0.0.0';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('API_PORT precisa ser uma porta válida');
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Encerrando a API DOMO');
  await app.close();
  await closeDatabase();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
