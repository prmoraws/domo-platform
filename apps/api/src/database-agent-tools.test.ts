import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findRelationshipPathInGraph,
} from './relationship-path.js';

test('encontra caminho real entre pessoas e blocos', () => {
  const path = findRelationshipPathInGraph(
    [
      {
        table: 'pessoas',
        column: 'igreja_id',
        referencedTable: 'igrejas',
        referencedColumn: 'id',
      },
      {
        table: 'igrejas',
        column: 'bloco_id',
        referencedTable: 'blocos',
        referencedColumn: 'id',
      },
    ],
    'pessoas',
    'blocos',
  );

  assert.equal(path?.length, 2);
  assert.equal(path?.[0]?.fromTable, 'pessoas');
  assert.equal(path?.[1]?.toTable, 'blocos');
});

test('não inventa caminho quando não existe relação', () => {
  assert.equal(
    findRelationshipPathInGraph([], 'pessoas', 'presidios'),
    null,
  );
});
