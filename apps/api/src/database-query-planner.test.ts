import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileDatabaseQueryPlan,
  normalizeDatabaseQueryPlan,
  type DatabaseQueryPlan,
} from './database-query-planner.js';

const tables = [
  {
    name: 'blocos',
    columns: [
      { name: 'id' },
      { name: 'nome' },
    ],
  },
  {
    name: 'regiaos',
    columns: [
      { name: 'id' },
      { name: 'nome' },
      { name: 'bloco_id' },
    ],
  },
  {
    name: 'igrejas',
    columns: [
      { name: 'id' },
      { name: 'nome' },
      { name: 'bloco_id' },
      { name: 'regiao_id' },
    ],
  },
  {
    name: 'pessoas',
    columns: [
      { name: 'id' },
      { name: 'nome' },
      { name: 'bloco_id' },
      { name: 'igreja_id' },
      { name: 'cargo_id' },
      { name: 'profissao' },
      { name: 'telefone' },
      { name: 'batismo', dataType: 'json' },
      { name: 'preso', dataType: 'json' },
      { name: 'conversao', dataType: 'date' },
    ],
  },
  {
    name: 'cargos',
    columns: [
      { name: 'id' },
      { name: 'nome' },
    ],
  },
  {
    name: 'presidios',
    columns: [
      { name: 'id' },
      { name: 'nome' },
      { name: 'diretor' },
      { name: 'contato_diretor' },
    ],
  },
];

const relationships = [
  {
    table: 'regiaos',
    column: 'bloco_id',
    referencedTable: 'blocos',
    referencedColumn: 'id',
  },
  {
    table: 'igrejas',
    column: 'bloco_id',
    referencedTable: 'blocos',
    referencedColumn: 'id',
  },
  {
    table: 'pessoas',
    column: 'bloco_id',
    referencedTable: 'blocos',
    referencedColumn: 'id',
  },
  {
    table: 'pessoas',
    column: 'cargo_id',
    referencedTable: 'cargos',
    referencedColumn: 'id',
  },
  {
    table: 'pessoas',
    column: 'igreja_id',
    referencedTable: 'igrejas',
    referencedColumn: 'id',
  },
  {
    table: 'igrejas',
    column: 'regiao_id',
    referencedTable: 'regiaos',
    referencedColumn: 'id',
  },
];

test('monta contagem de igrejas por bloco', () => {
  const plan: DatabaseQueryPlan = {
    sourceTable: 'igrejas',
    select: [
      {
        field: 'igrejas.id',
        aggregate: 'count',
        alias: 'total',
      },
    ],
    filters: [
      {
        field: 'blocos.nome',
        operator: 'contains',
        value: 'Pernambues',
      },
    ],
    groupBy: [],
    orderBy: [],
    limit: 20,
    explanation: 'Conta igrejas do bloco.',
  };

  const sql = compileDatabaseQueryPlan(
    plan,
    tables,
    relationships,
  );

  assert.match(
    sql,
    /JOIN `blocos` ON `igrejas`\.`bloco_id` = `blocos`\.`id`/,
  );
  assert.match(
    sql,
    /WHERE `blocos`\.`nome` LIKE '%Pernambues%'/,
  );
});

test('monta listagem de igrejas agrupadas por região', () => {
  const plan: DatabaseQueryPlan = {
    sourceTable: 'igrejas',
    select: [
      {
        field: 'regiaos.nome',
        aggregate: 'none',
        alias: 'regiao',
      },
      {
        field: 'igrejas.nome',
        aggregate: 'none',
        alias: 'igreja',
      },
    ],
    filters: [
      {
        field: 'blocos.nome',
        operator: 'contains',
        value: 'Teixeira de Freitas',
      },
    ],
    groupBy: [],
    orderBy: [
      {
        field: 'regiaos.nome',
        direction: 'asc',
      },
      {
        field: 'igrejas.nome',
        direction: 'asc',
      },
    ],
    limit: 20,
    explanation: 'Lista igrejas por região.',
  };

  const sql = compileDatabaseQueryPlan(
    plan,
    tables,
    relationships,
  );

  assert.match(sql, /JOIN `regiaos`/);
  assert.match(sql, /JOIN `blocos`/);
  assert.doesNotMatch(sql, /regioas|regiao_r/);
});

test('corrige contagem total sem agrupamento ou limite', () => {
  const incorrectPlan: DatabaseQueryPlan = {
    sourceTable: 'igrejas',
    select: [{
      field: 'blocos.nome',
      aggregate: 'count',
      alias: 'total',
    }],
    filters: [],
    groupBy: ['blocos.id'],
    orderBy: [],
    limit: 10,
    explanation: 'Plano original.',
  };

  const corrected = normalizeDatabaseQueryPlan(
    'Quantos registros tem na tabela igrejas?',
    incorrectPlan,
    tables,
    [],
  );

  const sql = compileDatabaseQueryPlan(
    corrected,
    tables,
    relationships,
  );

  assert.match(sql, /COUNT\(`igrejas`\.`id`\)/);
  assert.doesNotMatch(sql, /GROUP BY|LIMIT|JOIN/);
});

test('troca texto usado como chave pelo id da entidade', () => {
  const incorrectPlan: DatabaseQueryPlan = {
    sourceTable: 'igrejas',
    select: [{
      field: 'igrejas.nome',
      aggregate: 'count',
      alias: 'total',
    }],
    filters: [
      {
        field: 'igrejas.regiao_id',
        operator: 'equals',
        value: 'Alto de Coutos',
      },
      {
        field: 'igrejas.regiao_id',
        operator: 'equals',
        value: '$0',
      },
    ],
    groupBy: ['igrejas.id'],
    orderBy: [{
      field: 'igrejas.nome',
      direction: 'asc',
    }],
    limit: 10,
    explanation: 'Plano original.',
  };

  const corrected = normalizeDatabaseQueryPlan(
    'Quais são as igrejas da região Alto de Coutos?',
    incorrectPlan,
    tables,
    [{
      searchedValue: 'Alto de Coutos',
      table: 'regiaos',
      id: 7,
      name: 'Alto de Coutos',
      exact: true,
    }],
  );

  const sql = compileDatabaseQueryPlan(
    corrected,
    tables,
    relationships,
  );

  assert.match(sql, /WHERE `regiaos`\.`id` = 7/);
  assert.match(sql, /SELECT `igrejas`\.`nome`/);
  assert.doesNotMatch(sql, /\$0|COUNT|GROUP BY/);
});

test('remove id inventado e lista igreja e região do bloco', () => {
  const incorrectPlan: DatabaseQueryPlan = {
    sourceTable: 'igrejas',
    select: [{
      field: 'igrejas.nome',
      aggregate: 'none',
      alias: 'total',
    }],
    filters: [{
      field: 'blocos.id',
      operator: 'equals',
      value: '1234567890',
    }],
    groupBy: [],
    orderBy: [{
      field: 'regiaos.nome',
      direction: 'asc',
    }],
    limit: 20,
    explanation: 'Plano original incorreto.',
  };

  const corrected = normalizeDatabaseQueryPlan(
    'Liste os nomes das igrejas e regiões do bloco Teixeira de Freitas, organize por região',
    incorrectPlan,
    tables,
    [{
      searchedValue: 'Teixeira de Freitas',
      table: 'blocos',
      id: 19,
      name: 'Teixeira de Freitas',
      exact: true,
    }],
  );

  const sql = compileDatabaseQueryPlan(
    corrected,
    tables,
    relationships,
  );

  assert.match(sql, /`igrejas`\.`nome` AS `igreja`/);
  assert.match(sql, /`regiaos`\.`nome` AS `regiao`/);
  assert.match(sql, /WHERE `blocos`\.`id` = 19/);
  assert.doesNotMatch(sql, /1234567890/);
});

test('conta pessoas e usa o bloco somente como filtro', () => {
  const incorrectPlan: DatabaseQueryPlan = {
    sourceTable: 'blocos',
    select: [{
      field: 'blocos.id',
      aggregate: 'count',
      alias: 'total',
    }],
    filters: [],
    groupBy: [],
    orderBy: [],
    limit: 10,
    explanation: 'Plano original incorreto.',
  };

  const corrected = normalizeDatabaseQueryPlan(
    'Quantas pessoas tem no bloco Dois Leões?',
    incorrectPlan,
    tables,
    [{
      searchedValue: 'Dois Leões',
      table: 'blocos',
      id: 8,
      name: 'Dois Leões',
      exact: true,
    }],
  );

  const sql = compileDatabaseQueryPlan(
    corrected,
    tables,
    relationships,
  );

  assert.equal(corrected.sourceTable, 'pessoas');
  assert.match(sql, /COUNT\(`pessoas`\.`id`\) AS `total`/);
  assert.match(sql, /JOIN `blocos` ON `pessoas`\.`bloco_id` = `blocos`\.`id`/);
  assert.match(sql, /WHERE `blocos`\.`id` = 8/);
});

test('identifica pessoa pelo cargo e pelo bloco', () => {
  const incorrectPlan: DatabaseQueryPlan = {
    sourceTable: 'blocos',
    select: [{
      field: 'blocos.id',
      aggregate: 'count',
      alias: 'total',
    }],
    filters: [],
    groupBy: ['blocos.id'],
    orderBy: [],
    limit: 10,
    explanation: 'Plano original incorreto.',
  };

  const corrected = normalizeDatabaseQueryPlan(
    'Verifique em pessoas quem é o Líder do bloco Dois Leões?',
    incorrectPlan,
    tables,
    [
      {
        searchedValue: 'Líder',
        table: 'cargos',
        id: 2,
        name: 'Lider',
        exact: true,
      },
      {
        searchedValue: 'Dois Leões',
        table: 'blocos',
        id: 8,
        name: 'Dois Leões',
        exact: true,
      },
    ],
  );

  const sql = compileDatabaseQueryPlan(
    corrected,
    tables,
    relationships,
  );

  assert.equal(corrected.sourceTable, 'pessoas');
  assert.match(sql, /SELECT `pessoas`\.`nome` AS `pessoa`/);
  assert.match(sql, /JOIN `cargos` ON `pessoas`\.`cargo_id` = `cargos`\.`id`/);
  assert.match(sql, /WHERE `cargos`\.`id` = 2 AND `blocos`\.`id` = 8/);
  assert.doesNotMatch(sql, /COUNT|bloco_presidio/);
});

test('recupera filtro de coluna mencionado na pergunta', () => {
  const incompletePlan: DatabaseQueryPlan = {
    sourceTable: 'pessoas',
    select: [{
      field: 'pessoas.id',
      aggregate: 'count',
      alias: 'total',
    }],
    filters: [],
    groupBy: [],
    orderBy: [],
    limit: 10,
    explanation: 'O modelo esqueceu de estruturar o filtro.',
  };

  const corrected = normalizeDatabaseQueryPlan(
    'Das pessoas cadastradas quantas têm a profissão de cabeleireiro?',
    incompletePlan,
    tables,
    [],
  );

  const sql = compileDatabaseQueryPlan(
    corrected,
    tables,
    relationships,
  );

  assert.match(sql, /COUNT\(`pessoas`\.`id`\) AS `total`/);
  assert.match(
    sql,
    /WHERE `pessoas`\.`profissao` LIKE '%cabeleireiro%'/,
  );
});

test('distingue campo solicitado do nome pesquisado', () => {
  const incorrectPlan: DatabaseQueryPlan = {
    sourceTable: 'pessoas',
    select: [{
      field: 'blocos.nome',
      aggregate: 'count',
      alias: 'total',
    }],
    filters: [
      {
        field: 'blocos.nome',
        operator: 'equals',
        value: '',
      },
      {
        field: 'pessoas.telefone',
        operator: 'contains',
        value: 'Jesse Benigno Lisboa',
      },
    ],
    groupBy: [],
    orderBy: [],
    limit: 10,
    explanation: 'Plano original incorreto.',
  };

  const corrected = normalizeDatabaseQueryPlan(
    'Verifique em pessoas, qual o telefone de Jesse Benigno Lisboa?',
    incorrectPlan,
    tables,
    [],
  );

  const sql = compileDatabaseQueryPlan(
    corrected,
    tables,
    relationships,
  );

  assert.match(
    sql,
    /SELECT `pessoas`\.`nome` AS `pessoa`, `pessoas`\.`telefone` AS `telefone`/,
  );
  assert.match(
    sql,
    /WHERE `pessoas`\.`nome` LIKE '%jesse benigno lisboa%'/,
  );
  assert.doesNotMatch(sql, /COUNT|JOIN|`telefone` LIKE|= ''/);
});

test('consulta JSON do próprio registro sem tabela homônima', () => {
  const incorrectPlan: DatabaseQueryPlan = {
    sourceTable: 'pessoas',
    select: [{
      field: 'pessoas.batismo',
      aggregate: 'none',
      alias: 'batismo',
    }],
    filters: [{
      field: 'batismos.quantidade',
      operator: 'equals',
      value: 1,
    }],
    groupBy: [],
    orderBy: [],
    limit: 20,
    explanation: 'Plano original incorreto.',
  };

  const corrected = normalizeDatabaseQueryPlan(
    'Verifique em pessoas, qual o batismo de Jesse Benigno Lisboa?',
    incorrectPlan,
    tables,
    [],
  );

  const sql = compileDatabaseQueryPlan(
    corrected,
    tables,
    relationships,
  );

  assert.match(
    sql,
    /SELECT `pessoas`\.`nome` AS `pessoa`, `pessoas`\.`batismo` AS `batismo`/,
  );
  assert.match(
    sql,
    /WHERE `pessoas`\.`nome` LIKE '%jesse benigno lisboa%'/,
  );
  assert.doesNotMatch(sql, /JOIN|batismos|quantidade/);
});

test('entende data de conversão como coluna conversao', () => {
  const plan: DatabaseQueryPlan = {
    sourceTable: 'pessoas',
    select: [{ field: 'pessoas.nome', aggregate: 'none', alias: 'nome' }],
    filters: [],
    groupBy: [],
    orderBy: [],
    limit: 20,
    explanation: 'Plano incompleto.',
  };
  const corrected = normalizeDatabaseQueryPlan(
    'Verifique em pessoas, qual a data de conversao de Jesse Benigno Lisboa?',
    plan,
    tables,
    [],
  );
  const sql = compileDatabaseQueryPlan(corrected, tables, relationships);

  assert.match(sql, /`pessoas`\.`conversao` AS `conversao`/);
  assert.match(sql, /`pessoas`\.`nome` LIKE '%jesse benigno lisboa%'/);
  assert.doesNotMatch(sql, /JOIN|`conversao` LIKE/);
});

test('consulta JSON preso pelo nome da pessoa', () => {
  const plan: DatabaseQueryPlan = {
    sourceTable: 'pessoas',
    select: [{ field: 'blocos.nome', aggregate: 'count', alias: 'total' }],
    filters: [{ field: 'pessoas.preso', operator: 'contains', value: true }],
    groupBy: ['blocos.nome'],
    orderBy: [],
    limit: 10,
    explanation: 'Plano incorreto.',
  };
  const corrected = normalizeDatabaseQueryPlan(
    'Verifique em pessoas, se Jesse Benigno Lisboa já foi preso?',
    plan,
    tables,
    [],
  );
  const sql = compileDatabaseQueryPlan(corrected, tables, relationships);

  assert.match(sql, /`pessoas`\.`preso` AS `preso`/);
  assert.match(sql, /`pessoas`\.`nome` LIKE '%jesse benigno lisboa%'/);
  assert.doesNotMatch(sql, /COUNT|JOIN|GROUP BY|`preso` LIKE/);
});

test('consulta diretor e nome do presídio', () => {
  const plan: DatabaseQueryPlan = {
    sourceTable: 'presidios',
    select: [{ field: 'presidios.nome', aggregate: 'none', alias: 'nome' }],
    filters: [],
    groupBy: [],
    orderBy: [],
    limit: 20,
    explanation: 'Plano incompleto.',
  };
  const corrected = normalizeDatabaseQueryPlan(
    'Na tabela presidios, qual nome do diretor do Presídio de Salvador?',
    plan,
    tables,
    [],
  );
  const sql = compileDatabaseQueryPlan(corrected, tables, relationships);

  assert.match(
    sql,
    /SELECT `presidios`\.`nome` AS `presidio`, `presidios`\.`diretor` AS `diretor`/,
  );
  assert.match(
    sql,
    /`presidios`\.`nome` LIKE '%presidio de salvador%'/,
  );
  assert.doesNotMatch(sql, /contato_diretor|JOIN/);
});

test('consulta entidade relacionada de uma pessoa específica', () => {
  const plan: DatabaseQueryPlan = {
    sourceTable: 'pessoas',
    select: [
      { field: 'igrejas.nome', aggregate: 'none', alias: 'igreja' },
      { field: 'pessoas.nome', aggregate: 'none', alias: 'nome' },
    ],
    filters: [],
    groupBy: [],
    orderBy: [{ field: 'igrejas.nome', direction: 'asc' }],
    limit: 20,
    explanation: 'Plano sem filtro.',
  };
  const corrected = normalizeDatabaseQueryPlan(
    'Na tabela pessoas qual a igreja de Jesse Benigno Lisboa?',
    plan,
    tables,
    [],
  );
  const sql = compileDatabaseQueryPlan(corrected, tables, relationships);

  assert.match(
    sql,
    /SELECT `pessoas`\.`nome` AS `pessoa`, `igrejas`\.`nome` AS `igreja`/,
  );
  assert.match(
    sql,
    /JOIN `igrejas` ON `pessoas`\.`igreja_id` = `igrejas`\.`id`/,
  );
  assert.match(
    sql,
    /WHERE `pessoas`\.`nome` LIKE '%jesse benigno lisboa%'/,
  );
  assert.doesNotMatch(sql, /ORDER BY/);
});

test('consulta dias de visita preservando o nome do presídio', () => {
  const plan: DatabaseQueryPlan = {
    sourceTable: 'presidios',
    select: [
      { field: 'presidios.nome', aggregate: 'none', alias: 'presidio' },
      { field: 'presidios.visita', aggregate: 'none', alias: 'visita' },
    ],
    filters: [{
      field: 'presidios.nome',
      operator: 'contains',
      value: 'no presidio de salvador',
    }],
    groupBy: [],
    orderBy: [],
    limit: 20,
    explanation: 'Plano com preposição no filtro.',
  };
  const tablesWithVisit = tables.map(table =>
    table.name === 'presidios'
      ? {
        ...table,
        columns: [...table.columns, { name: 'visita' }],
      }
      : table,
  );
  const corrected = normalizeDatabaseQueryPlan(
    'Na tabela presídios, quais os dias de visita no Presídio de Salvador?',
    plan,
    tablesWithVisit,
    [],
  );
  const sql = compileDatabaseQueryPlan(
    corrected,
    tablesWithVisit,
    relationships,
  );

  assert.match(sql, /`presidios`\.`visita` AS `visita`/);
  assert.match(
    sql,
    /WHERE `presidios`\.`nome` LIKE '%presidio de salvador%'/,
  );
  assert.doesNotMatch(sql, /no presidio|COUNT|JOIN/);
});
