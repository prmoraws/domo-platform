import { timingSafeEqual } from 'node:crypto';
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

import {
  closeDatabase,
  getDatabaseStatus,
} from './database.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
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

app.get('/health', async () => {
  return {
    status: 'ok',
    service: 'domo-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  };
});

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
