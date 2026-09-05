export type CustomerMessageType =
  | 'text'
  | 'audio'
  | 'image'
  | 'video'
  | 'document'
  | 'sticker'
  | 'other';

export interface CustomerServicePolicyInput {
  messageType: CustomerMessageType;
  fromMe: boolean;
  isGroup: boolean;
  now?: Date;
  holidays?: readonly string[];
}

export interface CustomerServicePolicyResult {
  shouldRespond: boolean;
  reason:
    | 'text_allowed'
    | 'from_me'
    | 'group'
    | 'non_text'
    | 'live_program';
  isHoliday: boolean;
  isWeekend: boolean;
  isLiveProgramWindow: boolean;
  localDate: string;
  localTime: string;
}

const TIME_ZONE = 'America/Bahia';

const getBahiaParts = (date: Date) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
};

const getEasterSunday = (year: number): Date => {
  // Algoritmo de Meeus/Jones/Butcher.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
};

const dateInBahia = (date: Date): string => {
  const parts = getBahiaParts(date);
  return parts.date;
};

const addUtcDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 86_400_000);

const getBrazilNationalHolidays = (year: number): Set<string> => {
  const fixed = [
    `${year}-01-01`,
    `${year}-04-21`,
    `${year}-05-01`,
    `${year}-09-07`,
    `${year}-10-12`,
    `${year}-11-02`,
    `${year}-11-15`,
    `${year}-11-20`,
    `${year}-12-25`,
  ];

  const easter = getEasterSunday(year);

  // Sexta-feira da Paixão.
  const goodFriday = dateInBahia(addUtcDays(easter, -2));

  return new Set([
    ...fixed,
    goodFriday,
  ]);
};

export const evaluateCustomerServicePolicy = (
  input: CustomerServicePolicyInput,
): CustomerServicePolicyResult => {
  const now = input.now ?? new Date();
  const local = getBahiaParts(now);

  const year = Number(local.date.slice(0, 4));

  const holidays = getBrazilNationalHolidays(year);

  for (const holiday of input.holidays ?? []) {
    holidays.add(holiday);
  }

  const isHoliday = holidays.has(local.date);

  const isWeekend =
    local.weekday === 'Sat' ||
    local.weekday === 'Sun';

  const isWeekday = !isWeekend;

  const isLiveProgramWindow =
    isWeekday &&
    !isHoliday &&
    local.hour === 21;

  const base = {
    isHoliday,
    isWeekend,
    isLiveProgramWindow,
    localDate: local.date,
    localTime:
      `${String(local.hour).padStart(2, '0')}:` +
      `${String(local.minute).padStart(2, '0')}`,
  };

  if (input.fromMe) {
    return {
      ...base,
      shouldRespond: false,
      reason: 'from_me',
    };
  }

  if (input.isGroup) {
    return {
      ...base,
      shouldRespond: false,
      reason: 'group',
    };
  }

  if (input.messageType !== 'text') {
    return {
      ...base,
      shouldRespond: false,
      reason: 'non_text',
    };
  }

  if (isLiveProgramWindow) {
    return {
      ...base,
      shouldRespond: false,
      reason: 'live_program',
    };
  }

  return {
    ...base,
    shouldRespond: true,
    reason: 'text_allowed',
  };
};

export const CUSTOMER_SERVICE_TIME_ZONE = TIME_ZONE;
