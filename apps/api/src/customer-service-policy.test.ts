import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCustomerServicePolicy,
} from './customer-service-policy.js';

const date = (iso: string) => new Date(iso);

test('atende texto em dia útil antes do programa', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: false,
    isGroup: false,
    now: date('2026-09-04T20:00:00-03:00'),
  });

  assert.equal(result.shouldRespond, true);
  assert.equal(result.reason, 'text_allowed');
});

test('suspende texto de segunda a sexta entre 21h e 22h', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: false,
    isGroup: false,
    now: date('2026-09-04T21:30:00-03:00'),
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'live_program');
});

test('volta a atender às 22h', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: false,
    isGroup: false,
    now: date('2026-09-04T22:00:00-03:00'),
  });

  assert.equal(result.shouldRespond, true);
});

test('atende integralmente aos sábados', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: false,
    isGroup: false,
    now: date('2026-09-05T21:30:00-03:00'),
  });

  assert.equal(result.isWeekend, true);
  assert.equal(result.shouldRespond, true);
});

test('atende integralmente aos domingos', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: false,
    isGroup: false,
    now: date('2026-09-06T21:30:00-03:00'),
  });

  assert.equal(result.isWeekend, true);
  assert.equal(result.shouldRespond, true);
});

test('atende no feriado de 7 de setembro mesmo às 21h30', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: false,
    isGroup: false,
    now: date('2026-09-07T21:30:00-03:00'),
  });

  assert.equal(result.isHoliday, true);
  assert.equal(result.shouldRespond, true);
});

test('nunca responde áudio', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'audio',
    fromMe: false,
    isGroup: false,
    now: date('2026-09-04T18:00:00-03:00'),
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'non_text');
});

test('nunca responde imagem, vídeo, documento ou figurinha', () => {
  for (
    const messageType of
      ['image', 'video', 'document', 'sticker'] as const
  ) {
    const result = evaluateCustomerServicePolicy({
      messageType,
      fromMe: false,
      isGroup: false,
      now: date('2026-09-04T18:00:00-03:00'),
    });

    assert.equal(result.shouldRespond, false);
  }
});

test('não responde mensagens enviadas pelo próprio WhatsApp', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: true,
    isGroup: false,
    now: date('2026-09-04T18:00:00-03:00'),
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'from_me');
});

test('não responde em grupos', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: false,
    isGroup: true,
    now: date('2026-09-04T18:00:00-03:00'),
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'group');
});

test('aceita feriado local configurável', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: false,
    isGroup: false,
    now: date('2026-07-02T21:30:00-03:00'),
    holidays: ['2026-07-02'],
  });

  assert.equal(result.isHoliday, true);
  assert.equal(result.shouldRespond, true);
});

test('considera 2 de Julho feriado na Bahia', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: false,
    isGroup: false,
    now: new Date('2026-07-02T21:30:00-03:00'),
    holidays: ['2026-07-02'],
  });

  assert.equal(result.isHoliday, true);
  assert.equal(result.shouldRespond, true);
});

test('considera São João em Salvador quando configurado', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: false,
    isGroup: false,
    now: new Date('2026-06-24T21:30:00-03:00'),
    holidays: ['2026-06-24'],
  });

  assert.equal(result.isHoliday, true);
  assert.equal(result.shouldRespond, true);
});

test('considera Conceição da Praia quando configurado', () => {
  const result = evaluateCustomerServicePolicy({
    messageType: 'text',
    fromMe: false,
    isGroup: false,
    now: new Date('2026-12-08T21:30:00-03:00'),
    holidays: ['2026-12-08'],
  });

  assert.equal(result.isHoliday, true);
  assert.equal(result.shouldRespond, true);
});
