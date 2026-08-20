import fs from 'node:fs';

const parseEnv = path => {
  const values = {};

  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const raw = trimmed.slice(separator + 1).trim();
    values[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }

  return values;
};

const env = parseEnv('.env');
const token = env.API_INTERNAL_TOKEN;

if (!token) {
  throw new Error('API_INTERNAL_TOKEN não configurado no .env');
}

const checks = [
  {
    name: 'api',
    url: 'http://127.0.0.1:3001/health',
  },
  {
    name: 'database',
    url: 'http://127.0.0.1:3001/internal/database/status',
    authenticated: true,
  },
  {
    name: 'gemini-circuit',
    url: 'http://127.0.0.1:3001/internal/assistant/status',
    authenticated: true,
  },
  {
    name: 'n8n',
    url: 'http://127.0.0.1:5678/healthz',
  },
  {
    name: 'evolution',
    url: 'http://127.0.0.1:8080/',
  },
  {
    name: 'ollama',
    url: 'http://127.0.0.1:11434/api/version',
  },
];

const results = [];

for (const check of checks) {
  const startedAt = performance.now();

  try {
    const response = await fetch(check.url, {
      headers: check.authenticated
        ? { Authorization: `Bearer ${token}` }
        : undefined,
      signal: AbortSignal.timeout(5_000),
    });
    let detail;

    if (check.name === 'gemini-circuit' && response.ok) {
      const payload = await response.json();
      detail = payload.circuitBreaker?.state;
    }

    results.push({
      service: check.name,
      status: response.ok ? 'ok' : 'error',
      httpStatus: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      ...(detail ? { detail } : {}),
    });
  } catch {
    results.push({
      service: check.name,
      status: 'error',
      httpStatus: null,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}

const healthy = results.every(result => result.status === 'ok');

console.log(JSON.stringify({
  status: healthy ? 'ok' : 'error',
  checkedAt: new Date().toISOString(),
  services: results,
}, null, 2));

process.exitCode = healthy ? 0 : 1;
