import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateSelectSql,
} from './safe-sql-validator.js';

const allowedTables = new Set([
  'pessoas',
  'igrejas',
]);

test('aceita SELECT em tabela autorizada', () => {
  const result = validateSelectSql(
    'SELECT id, nome FROM pessoas',
    { allowedTables },
  );

  assert.equal(
    result.sql,
    'SELECT id, nome FROM pessoas LIMIT 20',
  );

  assert.deepEqual(result.tables, ['pessoas']);
});

test('reduz LIMIT acima do permitido', () => {
  const result = validateSelectSql(
    'SELECT nome FROM igrejas LIMIT 500',
    {
      allowedTables,
      maximumRows: 10,
    },
  );

  assert.equal(
    result.sql,
    'SELECT nome FROM igrejas LIMIT 10',
  );
});

test('aceita JOIN entre tabelas autorizadas', () => {
  const result = validateSelectSql(
    `
      SELECT pessoas.nome, igrejas.nome
      FROM pessoas
      JOIN igrejas ON igrejas.id = pessoas.igreja_id
    `,
    { allowedTables },
  );

  test('recusa SELECT com coluna protegida', () => {
    assert.throws(() =>
      validateSelectSql(
        'SELECT password FROM pessoas',
        {
          allowedTables,
          blockedColumns: new Set(['password']),
        },
      ),
    );
  });

  test('recusa SELECT com todas as colunas', () => {
    assert.throws(() =>
      validateSelectSql(
        'SELECT * FROM pessoas',
        { allowedTables },
      ),
    );
  });

  assert.deepEqual(
    result.tables.sort(),
    ['igrejas', 'pessoas'],
  );
});

const refusedQueries = [
  'DELETE FROM pessoas',
  'UPDATE pessoas SET nome = "teste"',
  'SELECT * FROM users',
  'SELECT * FROM pessoas; SELECT * FROM igrejas',
  'SELECT * FROM pessoas -- comentário',
  'SELECT * FROM pessoas UNION SELECT * FROM igrejas',
  'SELECT SLEEP(10) FROM pessoas',
];

for (const sql of refusedQueries) {
  test(`recusa SQL perigosa: ${sql}`, () => {
    assert.throws(() =>
      validateSelectSql(sql, {
        allowedTables,
      }),
    );
  });
}