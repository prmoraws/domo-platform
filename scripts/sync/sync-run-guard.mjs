import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  homedir,
} from 'node:os';

import {
  join,
} from 'node:path';

const stateDirectory = join(
  homedir(),
  'domo-data',
  'state',
);

const lockDirectory = join(
  stateDirectory,
  'production-sync.lock',
);

const lockFile = join(
  lockDirectory,
  'execution.json',
);

const statusFile = join(
  stateDirectory,
  'production-sync-status.json',
);

const processIsRunning = (pid) => {
  if (!Number.isInteger(pid) || pid < 1) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const removeStaleLock = () => {
  try {
    const previousExecution = JSON.parse(
      readFileSync(lockFile, 'utf8'),
    );

    if (processIsRunning(previousExecution.pid)) {
      return;
    }

    rmSync(lockDirectory, {
      recursive: true,
      force: true,
    });

    console.log(
      'Bloqueio antigo e inativo foi removido.',
    );
  } catch {
    // A ausência do arquivo significa que não há
    // bloqueio anterior para analisar.
  }
};

const writeJson = (file, data) => {
  writeFileSync(
    file,
    `${JSON.stringify(data, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  );
};

export const startSyncRun = () => {
  mkdirSync(stateDirectory, {
    recursive: true,
    mode: 0o700,
  });

  removeStaleLock();

  const startedAt = new Date().toISOString();

  try {
    mkdirSync(lockDirectory, {
      mode: 0o700,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      throw new Error(
        'Já existe uma sincronização DOMO em execução',
      );
    }

    throw error;
  }

  const execution = {
    pid: process.pid,
    status: 'running',
    startedAt,
  };

  writeJson(lockFile, execution);
  writeJson(statusFile, execution);

  let finished = false;

  const finish = ({
    status,
    message,
  }) => {
    if (finished) {
      return;
    }

    finished = true;

    writeJson(statusFile, {
      pid: process.pid,
      status,
      message,
      startedAt,
      finishedAt: new Date().toISOString(),
    });

    rmSync(lockDirectory, {
      recursive: true,
      force: true,
    });
  };

  return {
    finish,
    statusFile,
  };
};