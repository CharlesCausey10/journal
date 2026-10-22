const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = Number(process.env.SMOKE_PORT || 1213);
const debugPort = Number(process.env.SMOKE_DEBUG_PORT || 9335);
const windows = process.platform === 'win32';
const linuxCi = Boolean(process.env.CI) && process.platform === 'linux';
const preview = process.env.SMOKE_PREVIEW === '1';
const temporaryRoot = path.resolve(os.tmpdir());
const testData = fs.mkdtempSync(path.join(temporaryRoot, 'journal-smoke-'));
const child = spawn(
  windows ? 'npm.cmd' : 'npm',
  [
    ...(preview ? ['run', 'preview'] : ['start']),
    '--',
    ...(preview
      ? ['--skipBuild', '--', `--remote-debugging-port=${debugPort}`]
      : ['--remoteDebuggingPort', String(debugPort)]),
  ],
  {
    detached: !windows,
    shell: windows,
    env: {
      ...process.env,
      PORT: String(port),
      REMOTE_DEBUGGING_PORT: String(debugPort),
      JOURNAL_SMOKE_TEST_DATA: testData,
      ELECTRON_CLI_ARGS: JSON.stringify([
        ...(preview ? [`--remote-debugging-port=${debugPort}`] : []),
        ...(linuxCi ? ['--disable-gpu', '--disable-software-rasterizer', '--disable-dev-shm-usage'] : []),
      ]),
      ...(linuxCi
        ? {
            NO_SANDBOX: '1',
          }
        : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let output = '';
let exited = false;
let socket;
child.stdout.on('data', (data) => {
  output += data;
});
child.stderr.on('data', (data) => {
  output += data;
});
child.on('exit', () => {
  exited = true;
});
child.on('error', (error) => {
  output += error.stack;
  exited = true;
});

async function waitFor(check, description) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`npm start exited before ${description}`);
    const value = await check();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      return targets.find(
        (entry) =>
          entry.type === 'page' &&
          entry.url.startsWith(preview ? 'journal://app/' : `http://localhost:${port}`),
      );
    } catch {
      return null;
    }
  }, 'Electron renderer');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const requests = new Map();
  const exceptions = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown')
      exceptions.push(message.params);
    if (requests.has(message.id)) {
      requests.get(message.id)(message);
      requests.delete(message.id);
    }
  });
  function send(method, params = {}) {
    id += 1;
    const requestId = id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        requests.delete(requestId);
        reject(new Error(`Timed out: ${method}`));
      }, 15_000);
      requests.set(requestId, (message) => {
        clearTimeout(timeout);
        if (message.error || message.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(message)));
        } else resolve(message.result);
      });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.result.value;
  }
  await send('Runtime.enable');
  await waitFor(
    () =>
      evaluate('Boolean(document.querySelector(".journal-page.app-ready"))'),
    'Journal app initialization',
  );
  assert.equal(
    await evaluate('Boolean(document.querySelector("vite-error-overlay"))'),
    false,
  );
  assert.equal(
    await evaluate('Boolean(document.querySelector(".journal-page.app-ready .journal-shell"))'),
    true,
  );
  assert.equal(
    await evaluate('Boolean(document.querySelector(".load-message[role=alert]"))'),
    false,
  );
  assert.equal(
    await evaluate('Boolean(document.querySelector(".date-selector input[type=date]"))'),
    true,
  );
  assert.equal(await evaluate('window.electron.blocks.list().then(Array.isArray)'), true);
  assert.equal(await evaluate('typeof window.electron.ipcRenderer'), 'undefined');
  if (preview) {
    assert.equal(
      await evaluate(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("script-src 'self';")`),
      true,
    );
  }
  assert.deepEqual(exceptions, []);
  console.log(
    'Electron startup passed: Journal layout, date selector, preload IPC, and no renderer exceptions.',
  );
}

main()
  .finally(async () => {
    socket?.close();
    if (windows) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else if (child.pid) {
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
        if (signal === 'SIGTERM') await delay(1000);
      }
    }
    const resolvedData = path.resolve(testData);
    if (path.dirname(resolvedData) === temporaryRoot && path.basename(resolvedData).startsWith('journal-smoke-')) {
      fs.rmSync(resolvedData, { recursive: true, force: true, maxRetries: 3 });
    }
  })
  .catch((error) => {
    console.error(error);
    console.error(output);
    process.exitCode = 1;
  });
