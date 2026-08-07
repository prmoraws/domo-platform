export interface InterpretedDatabaseQuery {
  operation: 'count_records';
  table: string;
  confidence: number;
}

const normalizeQuestion = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const tableRules = [
  {
    table: 'pessoas',
    terms: [
      'pessoa',
      'pessoas',
      'cadastrado',
      'cadastrada',
      'cadastrados',
      'cadastradas',
    ],
  },
  {
    table: 'igrejas',
    terms: ['igreja', 'igrejas'],
  },
  {
    table: 'presidios',
    terms: [
      'presidio',
      'presidios',
      'unidade prisional',
      'unidades prisionais',
    ],
  },
  {
    table: 'cursos',
    terms: ['curso', 'cursos'],
  },
  {
    table: 'formaturas',
    terms: ['formatura', 'formaturas'],
  },
  {
    table: 'reeducandos',
    terms: ['reeducando', 'reeducandos'],
  },
] as const;

export const interpretDatabaseQuestion = (
  rawQuestion: unknown,
): InterpretedDatabaseQuery => {
  if (typeof rawQuestion !== 'string') {
    throw new Error('Pergunta não informada');
  }

  const question = normalizeQuestion(rawQuestion);

  if (!question) {
    throw new Error('Pergunta não informada');
  }

  const matchedRule = tableRules.find(rule =>
    rule.terms.some(term => question.includes(term)),
  );

  if (!matchedRule) {
    throw new Error('Consulta ainda não reconhecida');
  }

  return {
    operation: 'count_records',
    table: matchedRule.table,
    confidence: 1,
  };
};
