import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

interface WorkflowNode {
  name?: string;
  type?: string;
  webhookId?: string;
  parameters?: Record<string, unknown>;
}

interface Workflow {
  name?: string;
  active?: boolean;
  nodes?: WorkflowNode[];
  connections?: Record<string, unknown>;
}

const workflowUrl = new URL(
  '../../../infrastructure/n8n/workflows/20-atendimento-whatsapp.json',
  import.meta.url,
);

const loadWorkflow = (): Workflow =>
  JSON.parse(
    fs.readFileSync(workflowUrl, 'utf8'),
  ) as Workflow;

const nodeByName = (
  workflow: Workflow,
  name: string,
): WorkflowNode => {
  const node = workflow.nodes?.find(
    candidate => candidate.name === name,
  );

  assert.ok(
    node,
    `Nó obrigatório ausente: ${name}`,
  );

  return node;
};

test('workflow 20 mantém identidade e estrutura esperadas', () => {
  const workflow = loadWorkflow();

  assert.equal(
    workflow.name,
    'DOMO - 20 - Atendimento WhatsApp',
  );

  assert.equal(
    workflow.nodes?.length,
    7,
  );

  const expectedNodes = [
    'Webhook',
    'Preparar atendimento',
    'Responder?',
    'Consultar atendimento',
    'Registrar contexto',
    'Preparar resposta',
    'Responder WhatsApp',
  ];

  for (const name of expectedNodes) {
    nodeByName(workflow, name);
  }

  assert.equal(
    Object.keys(workflow.connections ?? {}).length,
    7,
  );
});

test('workflow 20 preserva webhook público crítico', () => {
  const workflow = loadWorkflow();
  const webhook = nodeByName(
    workflow,
    'Webhook',
  );

  assert.equal(
    webhook.webhookId,
    '5a44db51-36ba-440d-878b-fb01678a921b',
    'webhookId não pode ser removido ou alterado',
  );

  assert.equal(
    webhook.parameters?.path,
    'domo-atendimento-inbound',
  );

  assert.equal(
    webhook.parameters?.httpMethod,
    'POST',
  );
});

test('workflow 20 chama somente o agente de atendimento público', () => {
  const workflow = loadWorkflow();
  const query = nodeByName(
    workflow,
    'Consultar atendimento',
  );

  assert.equal(
    query.parameters?.url,
    'http://api:3001/internal/customer-service/query',
  );

  const serialized =
    JSON.stringify(workflow);

  const forbidden = [
    '/internal/assistant/query',
    'execute_readonly',
    'execute_readonly_query',
    'describe_database',
    'mariadb',
    'mysql',
  ];

  for (const value of forbidden) {
    assert.equal(
      serialized
        .toLocaleLowerCase('pt-BR')
        .includes(
          value.toLocaleLowerCase('pt-BR'),
        ),
      false,
      `Workflow público contém acesso proibido: ${value}`,
    );
  }
});

test('workflow 20 mantém filtros de segurança do WhatsApp', () => {
  const workflow = loadWorkflow();
  const prepare = nodeByName(
    workflow,
    'Preparar atendimento',
  );

  const code = String(
    prepare.parameters?.jsCode ?? '',
  );

  const required = [
    'domo-atendimento',
    'fromMe',
    'isGroup',
    'messageType',
    'shouldRespond',
    'America/Bahia',
  ];

  for (const value of required) {
    assert.match(
      code,
      new RegExp(
        value.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        ),
      ),
      `Filtro obrigatório ausente: ${value}`,
    );
  }
});

test('workflow 20 mantém suspensão durante o programa', () => {
  const workflow = loadWorkflow();
  const prepare = nodeByName(
    workflow,
    'Preparar atendimento',
  );

  const code = String(
    prepare.parameters?.jsCode ?? '',
  );

  assert.match(
    code,
    /isProgramWindow/,
  );

  assert.match(
    code,
    /21/,
  );

  assert.match(
    code,
    /22/,
  );
});

test('workflow 20 mantém deduplicação de mensagens', () => {
  const workflow = loadWorkflow();
  const prepare = nodeByName(
    workflow,
    'Preparar atendimento',
  );

  const code = String(
    prepare.parameters?.jsCode ?? '',
  );

  assert.match(
    code,
    /processedMessages/,
  );

  assert.match(
    code,
    /DEDUP_TTL_MS/,
  );

  assert.match(
    code,
    /duplicated/,
  );

  assert.match(
    code,
    /15\s*\*\s*60\s*\*\s*1000/,
  );
});

test('workflow 20 mantém feriados locais críticos', () => {
  const workflow = loadWorkflow();
  const prepare = nodeByName(
    workflow,
    'Preparar atendimento',
  );

  const code = String(
    prepare.parameters?.jsCode ?? '',
  );

  for (const holiday of [
    '-06-24',
    '-07-02',
    '-12-08',
  ]) {
    assert.match(
      code,
      new RegExp(holiday),
      `Feriado ausente: ${holiday}`,
    );
  }
});

test('workflow 20 suporta encerramento silencioso', () => {
  const workflow = loadWorkflow();

  const context = nodeByName(
    workflow,
    'Registrar contexto',
  );

  const code = String(
    context.parameters?.jsCode ?? '',
  );

  assert.match(
    code,
    /assistant\?\.silent/,
  );

  assert.match(
    code,
    /if \(silent\)/,
  );

  assert.match(
    code,
    /return \[\]/,
  );
});

test('workflow 20 limita repetição do fallback técnico', () => {
  const workflow = loadWorkflow();

  const context = nodeByName(
    workflow,
    'Registrar contexto',
  );

  const code = String(
    context.parameters?.jsCode ?? '',
  );

  assert.match(
    code,
    /customerFallbacks/,
  );

  assert.match(
    code,
    /FALLBACK_COOLDOWN_MS/,
  );

  assert.match(
    code,
    /10\s*\*\s*60\s*\*\s*1000/,
  );

  assert.match(
    code,
    /temporarily_unavailable/,
  );
});

test('todos os nós Code do workflow 20 possuem JavaScript válido', async () => {
  const vm = await import('node:vm');

  const workflow = loadWorkflow();

  for (const node of workflow.nodes ?? []) {
    if (
      node.type !== 'n8n-nodes-base.code'
    ) {
      continue;
    }

    const code = String(
      node.parameters?.jsCode ?? '',
    );

    assert.doesNotThrow(
      () =>
        new vm.Script(
          `(async () => {
${code}
})()`,
        ),
      `JavaScript inválido no nó: ${node.name}`,
    );
  }
});

test('fallback público é silencioso', () => {
  const server = fs.readFileSync(
    new URL('../src/server.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    server,
    /status:\s*'temporarily_unavailable'/,
  );

  assert.match(
    server,
    /silent:\s*true/,
  );

  assert.doesNotMatch(
    server,
    /No momento não consegui concluir essa orientação/,
  );
});
