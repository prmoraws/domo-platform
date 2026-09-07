import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import {
  TelegramClient,
} from 'teleproto';

import {
  StringSession,
} from 'teleproto/sessions/index.js';

const apiIdRaw =
  process.env.TELEGRAM_API_ID ?? '';

const apiHash =
  process.env.TELEGRAM_API_HASH ?? '';

const sessionFile =
  process.env.TELEGRAM_SESSION_FILE ??
  path.resolve(
    process.cwd(),
    '../../data/telegram-user/session.txt',
  );

if (!/^\d+$/.test(apiIdRaw)) {
  throw new Error(
    'TELEGRAM_API_ID ausente ou inválido.',
  );
}

if (!/^[0-9a-fA-F]{32}$/.test(apiHash)) {
  throw new Error(
    'TELEGRAM_API_HASH ausente ou inválido.',
  );
}

const apiId = Number(apiIdRaw);

const existingSession =
  fs.existsSync(sessionFile)
    ? fs.readFileSync(sessionFile, 'utf8').trim()
    : '';

const session =
  new StringSession(existingSession);

const client =
  new TelegramClient(
    session,
    apiId,
    apiHash,
    {
      connectionRetries: 5,
    },
  );

const rl =
  readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

const ask = question =>
  new Promise(resolve =>
    rl.question(question, resolve)
  );

const askHidden = question =>
  new Promise(resolve => {
    process.stdout.write(question);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let value = '';

    const handler = chunk => {
      const text = chunk.toString();

      for (const char of text) {
        if (
          char === '\r' ||
          char === '\n'
        ) {
          stdin.off('data', handler);

          if (stdin.isTTY) {
            stdin.setRawMode(
              Boolean(wasRaw),
            );
          }

          process.stdout.write('\n');
          resolve(value);
          return;
        }

        if (
          char === '\u0003'
        ) {
          process.exit(130);
        }

        if (
          char === '\u007f' ||
          char === '\b'
        ) {
          value =
            value.slice(0, -1);
          continue;
        }

        value += char;
      }
    };

    stdin.on('data', handler);
  });

try {
  console.log(
    '=== AUTENTICAÇÃO TELEGRAM MTProto ===',
  );

  await client.start({
    phoneNumber: async () =>
      (
        await ask(
          'Número Telegram (+55...): ',
        )
      ).trim(),

    phoneCode: async () =>
      (
        await ask(
          'Código recebido no Telegram: ',
        )
      ).trim(),

    password: async () =>
      await askHidden(
        'Senha 2FA (se houver): ',
      ),

    onError: error => {
      console.error(
        'Telegram auth:',
        error?.message ?? error,
      );
    },
  });

  const me =
    await client.getMe();

  const saved =
    client.session.save();

  fs.mkdirSync(
    path.dirname(sessionFile),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    sessionFile,
    `${saved}\n`,
    {
      mode: 0o600,
    },
  );

  fs.chmodSync(
    sessionFile,
    0o600,
  );

  console.log();
  console.log(
    'AUTENTICAÇÃO CONCLUÍDA.',
  );

  console.log({
    id: String(me?.id ?? ''),
    username:
      me?.username ?? null,
    firstName:
      me?.firstName ?? null,
    phoneConfigured:
      Boolean(me?.phone),
    sessionSaved: true,
  });
} finally {
  rl.close();

  await client.disconnect()
    .catch(() => {});
}
