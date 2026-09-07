import fs from 'node:fs';

const file =
  process.env.TELEGRAM_HEALTH_FILE ??
  '/tmp/telegram-user-health.json';

if (!fs.existsSync(file)) {
  process.exit(1);
}

try {
  const data =
    JSON.parse(
      fs.readFileSync(file, 'utf8'),
    );

  const timestamp =
    Date.parse(data.timestamp);

  const age =
    Date.now() - timestamp;

  if (
    data.status !== 'ok' ||
    data.connected !== true ||
    !Number.isFinite(timestamp) ||
    age > 90_000
  ) {
    process.exit(1);
  }

  process.exit(0);
} catch {
  process.exit(1);
}
