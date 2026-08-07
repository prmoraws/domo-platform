import {
  spawnSync,
} from 'node:child_process';

import {
  resolve,
} from 'node:path';

import {
  startSyncRun,
} from './sync-run-guard.mjs';

const projectDirectory = resolve(
  import.meta.dirname,
  '..',
  '..',
);

const executeRequested =
  process.argv.includes('--execute');

const steps = [
  {
    name: 'Criar backup da produção',
    file: 'scripts/sync/backup-production-database.mjs',
  },
  {
    name: 'Restaurar backup no slot inativo',
    file: 'scripts/sync/restore-latest-to-staging.mjs',
  },
  {
    name: 'Validar o slot inativo',
    file: 'scripts/sync/validate-staging.mjs',
  },
  {
    name: 'Promover o slot inativo',
    file: 'scripts/sync/promote-inactive-replica.mjs',
  },
];

const sanitizedEnvironment = {
  ...process.env,
};

/*
 * Evita que variáveis antigas exportadas no terminal
 * sobrescrevam os valores atuais do arquivo .env.
 */
delete sanitizedEnvironment.MYSQL_DATABASE;
delete sanitizedEnvironment.REPLICA_BLUE_DATABASE;
delete sanitizedEnvironment.REPLICA_GREEN_DATABASE;

const runStep = (step, position) => {
  console.log('\n========================================');
  console.log(`ETAPA ${position}/${steps.length}`);
  console.log(step.name);
  console.log('========================================\n');

  const result = spawnSync(
    process.execPath,
    [
      step.file,
    ],
    {
      cwd: projectDirectory,
      env: sanitizedEnvironment,
      stdio: 'inherit',
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `A etapa "${step.name}" terminou com erro`,
    );
  }
};

console.log('SINCRONIZAÇÃO DA RÉPLICA DOMO');
console.log('Origem: banco de produção somente leitura');
console.log('Destino: slot local inativo');
console.log('Promoção: azul/verde com rollback');

if (!executeRequested) {
  console.log('\nMODO DE VISUALIZAÇÃO');
  console.log('Nenhuma etapa foi executada.\n');

  for (
    const [index, step] of steps.entries()
  ) {
    console.log(
      `${index + 1}. ${step.name}`,
    );
  }

  console.log(
    '\nPara executar, acrescente --execute.',
  );

  process.exit(0);
}

let syncRun;

try {
  syncRun = startSyncRun();
} catch (error) {
  console.error(
    '\nSINCRONIZAÇÃO NÃO INICIADA',
  );

  console.error(
    error instanceof Error
      ? error.message
      : 'Não foi possível obter o bloqueio',
  );

  process.exit(1);
}

let finalStatus = 'success';
let finalMessage =
  'Sincronização concluída com sucesso';

try {
  for (
    const [index, step] of steps.entries()
  ) {
    runStep(
      step,
      index + 1,
    );
  }

  console.log(
    '\nSINCRONIZAÇÃO COMPLETA CONCLUÍDA COM SUCESSO',
  );

  console.log(
    'A API está usando a réplica recém-atualizada.',
  );
} catch (error) {
  console.error(
    '\nSINCRONIZAÇÃO INTERROMPIDA',
  );

  if (error instanceof Error) {
    console.error(error.message);
  }

  console.error(
    'As etapas seguintes não foram executadas.',
  );

  finalStatus = 'error';

  finalMessage =
    error instanceof Error
      ? error.message
      : 'Erro desconhecido';

  process.exitCode = 1;
} finally {
  syncRun.finish({
    status: finalStatus,
    message: finalMessage,
  });

  console.log(
    `Estado gravado em: ${syncRun.statusFile}`,
  );
}