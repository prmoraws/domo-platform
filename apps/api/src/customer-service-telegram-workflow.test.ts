import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

interface WorkflowNode {
  name?: string;
  type?: string;
  parameters?: Record<string, unknown>;
}

interface Workflow {
  name?: string;
  active?: boolean;
  nodes?: WorkflowNode[];
  connections?: Record<string, unknown>;
}

const workflowUrl = new URL(
  '../../../infrastructure/n8n/workflows/30-atendimento-telegram.json',
  import.meta.url,
);

const loadWorkflow = (): Workflow =>
  JSON.parse(fs.readFileSync(workflowUrl, 'utf8')) as Workflow;

const nodeByName = (
  workflow: Workflow,
  name: string,
): WorkflowNode => {
  const node = workflow.nodes?.find(candidate => candidate.name === name);
  assert.ok(node, `Nó obrigatório ausente: ${name}`);
  return node;
};

test('workflow 30 mantém identidade e começa desativado', () => {
  const workflow = loadWorkflow();

  assert.equal(workflow.name, 'DOMO - 30 - Atendimento Telegram');
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes?.length, 7);

  for (const name of [
    'Telegram Trigger',
    'Preparar atendimento',
    'Responder?',
    'Consultar atendimento',
    'Registrar contexto',
    'Preparar resposta',
    'Responder Telegram',
  ]) {
    nodeByName(workflow, name);
  }
});

test('workflow 30 reutiliza somente o atendimento público', () => {
  const workflow = loadWorkflow();
  const query = nodeByName(workflow, 'Consultar atendimento');

  assert.equal(
    query.parameters?.url,
    'http://api:3001/internal/customer-service/query',
  );

  const serialized = JSON.stringify(workflow).toLocaleLowerCase('pt-BR');

  for (const forbidden of [
    '/internal/assistant/query',
    'execute_readonly',
    'mariadb',
    'mysql',
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `Workflow Telegram contém acesso proibido: ${forbidden}`,
    );
  }
});

test('workflow 30 separa sessão e deduplicação por Telegram', () => {
  const workflow = loadWorkflow();
  const prepare = nodeByName(workflow, 'Preparar atendimento');
  const code = String(prepare.parameters?.jsCode ?? '');

  assert.match(code, /telegram:\$\{chatId\}/);
  assert.match(code, /processedMessages/);
  assert.match(code, /DEDUP_TTL_MS/);
  assert.match(code, /message_id/);
  assert.match(code, /chat\.type/);
  assert.match(code, /is_bot/);
});

test('workflow 30 não responde automaticamente a mídia', () => {
  const workflow = loadWorkflow();
  const prepare = nodeByName(workflow, 'Preparar atendimento');
  const code = String(prepare.parameters?.jsCode ?? '');

  assert.match(code, /message\.voice/);
  assert.match(code, /message\.audio/);
  assert.match(code, /messageType === 'text'/);
  assert.match(code, /non_text/);
});

test('workflow 30 adapta orientação de canal para o próprio Telegram', () => {
  const workflow = loadWorkflow();
  const context = nodeByName(workflow, 'Registrar contexto');
  const code = String(context.parameters?.jsCode ?? '');

  assert.match(code, /por aqui mesmo, pelo Telegram/);
  assert.match(code, /recebendo os áudios por aqui normalmente/);
  assert.match(code, /WhatsApp também recebe os áudios/);
});

test('workflow 30 respeita resposta silenciosa e fallback silencioso', () => {
  const workflow = loadWorkflow();
  const context = nodeByName(workflow, 'Registrar contexto');
  const code = String(context.parameters?.jsCode ?? '');

  assert.match(code, /assistant\?\.silent/);
  assert.match(code, /if \(silent \|\| !answer\)/);
  assert.match(code, /return \[\]/);
});

test('todos os nós Code do workflow 30 possuem JavaScript válido', async () => {
  const vm = await import('node:vm');
  const workflow = loadWorkflow();

  for (const node of workflow.nodes ?? []) {
    if (node.type !== 'n8n-nodes-base.code') {
      continue;
    }

    const code = String(node.parameters?.jsCode ?? '');

    assert.doesNotThrow(
      () => new vm.Script(`(async () => {\n${code}\n})()`),
      `JavaScript inválido no nó: ${node.name}`,
    );
  }
});
