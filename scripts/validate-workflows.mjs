import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflowPath = process.argv[2] ??
  'infrastructure/n8n/workflows/10-entrada-whatsapp.json';
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

assert.equal(Array.isArray(workflow), false, 'A raiz deve ser um objeto');
assert.ok(Array.isArray(workflow.nodes), 'nodes deve ser um array');
assert.equal(typeof workflow.connections, 'object');

const nodeNames = workflow.nodes.map(node => node.name);
const names = new Set(nodeNames);
assert.equal(names.size, nodeNames.length, 'Nomes de nós duplicados');

for (const [source, outputs] of Object.entries(workflow.connections)) {
  assert.ok(names.has(source), `Origem inexistente: ${source}`);
  for (const branch of outputs.main ?? []) {
    for (const connection of branch) {
      assert.ok(names.has(connection.node), `Destino inexistente: ${connection.node}`);
    }
  }
}

const codeNodes = workflow.nodes.filter(
  node => node.type === 'n8n-nodes-base.code',
);
for (const node of codeNodes) new Function(node.parameters.jsCode);

const serialized = JSON.stringify(workflow);
assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9._-]{12,}/i);
assert.doesNotMatch(serialized, /AIza[A-Za-z0-9_-]{20,}/);

const sessionNode = workflow.nodes.find(
  node => node.name === 'Gerenciar sessão',
);
assert.ok(sessionNode, 'Nó Gerenciar sessão ausente');

const state = {};
const env = {
  DOMO_WHATSAPP_ALLOWED_JID: '5511999999999@s.whatsapp.net',
  DOMO_WHATSAPP_INSTANCE_NAME: 'domo-assistente',
  DOMO_WHATSAPP_COMMAND_PREFIX: 'domo:',
  DOMO_WHATSAPP_SESSION_MINUTES: '20',
};
const executeSession = new Function(
  '$input', '$env', '$getWorkflowStaticData',
  sessionNode.parameters.jsCode,
);
const event = (text, overrides = {}) => ({
  first: () => ({ json: { body: {
    instance: overrides.instance ?? 'domo-assistente',
    data: {
      key: {
        remoteJid: overrides.remoteJid ?? '5511999999999@s.whatsapp.net',
        fromMe: overrides.fromMe ?? true,
        id: 'message-id',
      },
      message: { conversation: text },
    },
  } } }),
});
const runSession = text => executeSession(
  event(text), env, () => state,
)[0].json;

assert.equal(runSession('domo:').authorized, true);
const activeQuestion = runSession('Quantas igrejas existem?');
assert.equal(activeQuestion.shouldQuery, true);
assert.equal(activeQuestion.question, 'Quantas igrejas existem?');
assert.equal(runSession('domo: sair').shouldQuery, false);
assert.equal(runSession('Pergunta após sair').authorized, false);

const unauthorized = executeSession(
  event('domo: teste', { remoteJid: '5500000000000@s.whatsapp.net' }),
  env,
  () => state,
)[0].json;
assert.equal(unauthorized.authorized, false);

console.log(JSON.stringify({
  status: 'ok',
  workflow: workflow.name,
  active: workflow.active,
  nodes: workflow.nodes.length,
  connections: Object.keys(workflow.connections).length,
  sessionTests: 5,
  secrets: 'not_found',
}));
