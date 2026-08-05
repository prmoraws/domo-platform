import Fastify from 'fastify';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

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

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? '0.0.0.0';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('API_PORT precisa ser uma porta válida');
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Encerrando a API DOMO');
  await app.close();
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
