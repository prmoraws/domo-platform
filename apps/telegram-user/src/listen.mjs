import fs from 'node:fs';
import path from 'node:path';

import {
  TelegramClient,
  events,
} from 'teleproto';

import {
  StringSession,
} from 'teleproto/sessions/index.js';

const apiIdRaw =
  process.env.TELEGRAM_API_ID ?? '';

const apiHash =
  process.env.TELEGRAM_API_HASH ?? '';

const apiUrl =
  process.env.DOMO_CUSTOMER_SERVICE_URL ??
  'http://127.0.0.1:3001/internal/customer-service/query';

const apiToken =
  process.env.API_INTERNAL_TOKEN ?? '';

if (!apiToken) {
  throw new Error(
    'API_INTERNAL_TOKEN não configurado.',
  );
}

const sessionFile =
  process.env.TELEGRAM_SESSION_FILE ??
  path.resolve(
    process.cwd(),
    '../../data/telegram-user/session.txt',
  );

if (!/^\d+$/.test(apiIdRaw)) {
  throw new Error('TELEGRAM_API_ID ausente ou inválido.');
}

if (!/^[0-9a-fA-F]{32}$/.test(apiHash)) {
  throw new Error('TELEGRAM_API_HASH ausente ou inválido.');
}

if (!fs.existsSync(sessionFile)) {
  throw new Error(`Sessão não encontrada: ${sessionFile}`);
}

const sessionValue =
  fs.readFileSync(sessionFile, 'utf8').trim();

if (!sessionValue) {
  throw new Error('Sessão Telegram vazia.');
}

const client =
  new TelegramClient(
    new StringSession(sessionValue),
    Number(apiIdRaw),
    apiHash,
    {
      connectionRetries: 10,
    },
  );

console.log('=== DOMO TELEGRAM USER ===');
console.log('Canal: conta Telegram normal');

await client.connect();

const healthFile =
  process.env.TELEGRAM_HEALTH_FILE ??
  '/tmp/telegram-user-health.json';

const writeHealth = () => {
  fs.writeFileSync(
    healthFile,
    JSON.stringify({
      status: client.connected ? 'ok' : 'disconnected',
      connected: Boolean(client.connected),
      timestamp: new Date().toISOString(),
    }) + '\n',
  );
};

writeHealth();

const healthTimer =
  setInterval(
    writeHealth,
    30_000,
  );

healthTimer.unref();

const me =
  await client.getMe();

console.log({
  connected: true,
  selfId: String(me?.id ?? ''),
  username: me?.username ?? null,
  firstName: me?.firstName ?? null,
});

const processing =
  new Set();

const sessions =
  new Map();

const SESSION_MINUTES = 30;
const SESSION_TTL_MS =
  SESSION_MINUTES * 60 * 1000;

const TIME_ZONE =
  'America/Bahia';

const getOperationalContext = () => {
  const formatter =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      },
    );

  const parts =
    Object.fromEntries(
      formatter
        .formatToParts(new Date())
        .filter(
          part =>
            part.type !== 'literal',
        )
        .map(
          part => [
            part.type,
            part.value,
          ],
        ),
    );

  const localDate =
    `${parts.year}-${parts.month}-${parts.day}`;

  const localTime =
    `${parts.hour}:${parts.minute}`;

  const fixedHolidays =
    new Set([
      `${parts.year}-01-01`,
      `${parts.year}-04-21`,
      `${parts.year}-05-01`,
      `${parts.year}-06-24`,
      `${parts.year}-07-02`,
      `${parts.year}-09-07`,
      `${parts.year}-10-12`,
      `${parts.year}-11-02`,
      `${parts.year}-11-15`,
      `${parts.year}-11-20`,
      `${parts.year}-12-08`,
      `${parts.year}-12-25`,
    ]);

  return {
    localDate,
    localTime,
    isHoliday:
      fixedHolidays.has(localDate),
  };
};

client.addEventHandler(
  async event => {
    const message =
      event?.message;

    if (!message || message.out === true) {
      return;
    }

    const sender =
      await message.getSender().catch(() => null);

    const chat =
      await message.getChat().catch(() => null);

    /*
     * Nesta primeira integração:
     * - somente mensagens privadas;
     * - ignora bots;
     * - ignora grupos/canais.
     */
    if (
      !sender ||
      sender.bot ||
      chat?.broadcast ||
      chat?.megagroup
    ) {
      return;
    }

    const text =
      String(message.message ?? '').trim();

    /*
     * Áudio/mídia será tratado separadamente.
     * Por enquanto somente texto entra no RAG.
     */
    if (!text) {
      console.log({
        event: 'telegram_message_ignored',
        reason: 'non_text_message',
        messageId: Number(message.id),
        senderId: String(sender.id ?? ''),
      });

      return;
    }

    const key =
      `${String(sender.id)}:${String(message.id)}`;

    if (processing.has(key)) {
      return;
    }

    processing.add(key);

    console.log({
      event: 'telegram_query_received',
      messageId: Number(message.id),
      senderId: String(sender.id ?? ''),
      text: text.slice(0, 200),
    });

    try {
      const senderKey =
        String(sender.id);

      const now =
        Date.now();

      const previous =
        sessions.get(senderKey);

      const firstInteraction =
        !previous ||
        (
          now -
          previous.lastSeen
        ) > SESSION_TTL_MS;

      const operational =
        getOperationalContext();

      const history =
        Array.isArray(previous?.history)
          ? previous.history.slice(-10)
          : [];

      const response =
        await fetch(
          apiUrl,
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/json',
              'authorization':
                `Bearer ${apiToken}`,
            },
            body: JSON.stringify({
              message: text,
              firstInteraction,
              isHoliday:
                operational.isHoliday,
              localDate:
                operational.localDate,
              localTime:
                operational.localTime,
              history,
            }),
            signal:
              AbortSignal.timeout(30000),
          },
        );

      if (!response.ok) {
        throw new Error(
          `DOMO API HTTP ${response.status}`,
        );
      }

      const data =
        await response.json();

      /*
       * Não inventamos fallback.
       * Só respondemos quando a API efetivamente
       * devolver uma resposta pública utilizável.
       */
      const silent =
        data?.assistant?.silent === true;

      const answer =
        typeof data?.assistant?.answer === 'string'
          ? data.assistant.answer.trim()
          : '';

      if (silent) {
        sessions.set(
          senderKey,
          {
            lastSeen: Date.now(),
            history: [
              ...history,
              {
                role: 'user',
                text,
              },
            ].slice(-10),
          },
        );

        console.log({
          event:
            'telegram_query_silent',
          messageId:
            Number(message.id),
          senderId:
            String(sender.id ?? ''),
        });

        return;
      }

      if (!answer) {
        console.log({
          event: 'telegram_query_no_answer',
          messageId: Number(message.id),
          senderId: String(sender.id ?? ''),
        });

        return;
      }

      await message.reply({
        message: answer,
      });

      sessions.set(
        senderKey,
        {
          lastSeen: Date.now(),
          history: [
            ...history,
            {
              role: 'user',
              text,
            },
            {
              role: 'assistant',
              text: answer,
            },
          ].slice(-10),
        },
      );

      console.log({
        event: 'telegram_answer_sent',
        messageId: Number(message.id),
        senderId: String(sender.id ?? ''),
        answerLength: answer.length,
      });
    } catch (error) {
      /*
       * Falha técnica permanece silenciosa
       * para o usuário público.
       */
      console.error({
        event: 'telegram_query_failed',
        messageId: Number(message.id),
        senderId: String(sender.id ?? ''),
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    } finally {
      processing.delete(key);
    }
  },
  new events.NewMessage({}),
);

console.log(
  'Aguardando mensagens privadas...',
);

await new Promise(() => {});
