const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const exe = path.resolve(
  process.argv[2] ?? 'src-tauri/target/release/journal.exe',
);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-smoke-'));
const note = 'Saved when the Journal window closes';
const diagnostics = path.resolve('output/test-temp');
fs.mkdirSync(diagnostics, { recursive: true });

async function until(get, description) {
  const deadline = Date.now() + (process.env.CI ? 180000 : 45000);
  while (Date.now() < deadline) {
    const value = await get();
    if (value) return value;
    await delay(100);
  }
  throw Error('Timed out waiting for ' + description);
}

async function run(reopen) {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const runDiagnostics = path.join(
    diagnostics,
    reopen ? 'reopen' : 'first-launch',
  );
  fs.mkdirSync(runDiagnostics, { recursive: true });
  const browserArguments = ['--remote-debugging-port=' + port];
  if (process.env.GITHUB_ACTIONS === 'true') {
    browserArguments.push(
      '--enable-logging',
      '--log-file=' + JSON.stringify(path.join(runDiagnostics, 'webview.log')),
    );
  }
  const child = spawn(exe, [], {
    windowsHide: true,
    env: {
      ...process.env,
      JOURNAL_SMOKE_TEST_DATA: directory,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArguments.join(' '),
    },
  });
  let launchError;
  let output = '';
  let targets = [];
  const endpoint = {
    attempts: 0,
    successes: 0,
    lastError: null,
    status: null,
    body: null,
  };
  child.on('error', (error) => {
    launchError = error;
  });
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  let socket;
  try {
    const target = await until(async () => {
      if (launchError) throw launchError;
      if (child.exitCode !== null)
        throw Error('Journal exited with ' + child.exitCode);
      endpoint.attempts += 1;
      try {
        const response = await fetch(
          'http://127.0.0.1:' + port + '/json/list',
          {
            signal: AbortSignal.timeout(2000),
          },
        );
        endpoint.successes += 1;
        endpoint.status = response.status;
        endpoint.body = await response.text();
        targets = JSON.parse(endpoint.body);
        if (!response.ok || !Array.isArray(targets)) {
          throw Error('Unexpected debugging endpoint response');
        }
      } catch (error) {
        endpoint.lastError = {
          message: String(error),
          cause: String(error.cause ?? ''),
        };
        return false;
      }
      return targets.find((t) =>
        /^https?:\/\/tauri\.localhost(?:[/:]|$)/.test(t.url),
      );
    }, 'the local Journal webview');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let next = 0;
    async function evaluate(expression) {
      const id = ++next;
      const message = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.removeEventListener('message', listener);
          reject(Error('Journal did not respond to a smoke-test action'));
        }, 10000);
        const listener = (e) => {
          const data = JSON.parse(e.data);
          if (data.id !== id) return;
          clearTimeout(timeout);
          socket.removeEventListener('message', listener);
          if (data.error || data.result.exceptionDetails)
            reject(Error(JSON.stringify(data)));
          else resolve(data.result.result.value);
        };
        socket.addEventListener('message', listener);
      });
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
      return message;
    }
    const editor =
      'document.querySelector(\'[contenteditable="true"][aria-label="Notes"]\')';
    await until(async () => {
      if (await evaluate('Boolean(' + editor + ')')) return true;
      const alert = await evaluate(
        "document.querySelector('main[role=alert]')?.innerText",
      );
      if (alert) throw Error(alert);
      return false;
    }, 'the Notes editor');
    if (reopen) {
      assert.equal(await evaluate(editor + '.innerText.trim()'), note);
      assert.equal(
        await evaluate(
          'window.journal.layout.get().then(x => x.moveCheckedToBottom)',
        ),
        true,
      );
    } else {
      await evaluate('window.journal.settings.setMoveCheckedToBottom(true)');
      await evaluate(editor + '.focus()');
      assert.equal(
        await evaluate(
          "document.execCommand('insertText',false," +
            JSON.stringify(note) +
            ')',
        ),
        true,
      );
      assert.equal(await evaluate(editor + '.innerText.trim()'), note);
    }
    // Trigger the real WebView close event during the editor's autosave delay.
    await evaluate(
      'setTimeout(() => window.__TAURI__.window.getCurrentWindow().close(), 0); true',
    );
    await until(() => child.exitCode !== null, 'Journal to exit');
    assert.equal(child.exitCode, 0);
  } catch (error) {
    fs.writeFileSync(
      path.join(diagnostics, 'windows-startup.json'),
      JSON.stringify(
        {
          error: String(error),
          executable: exe,
          directory,
          port,
          exitCode: child.exitCode,
          signal: child.signalCode,
          targets,
          output,
          endpoint,
        },
        null,
        2,
      ),
    );
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.resolve('scripts/collect-windows-startup.ps1'),
          '-Destination',
          runDiagnostics,
        ],
        { timeout: 30000, windowsHide: true, stdio: 'pipe' },
      );
    } catch (collectionError) {
      console.error(
        'Could not collect process diagnostics',
        String(collectionError),
      );
    }
    console.error('Startup diagnostics', {
      port,
      targets,
      output,
      directory,
      endpoint,
    });
    throw error;
  } finally {
    socket?.close();
    if (child.exitCode === null) child.kill();
  }
}

(async () => {
  assert.equal(process.platform, 'win32');
  assert.ok(fs.existsSync(exe), 'Build the Windows app first');
  await run(false);
  await run(true);
  fs.writeFileSync(
    path.resolve('output/test-temp/last-smoke-directory.txt'),
    directory,
  );
  console.log(
    'Packaged Journal saved an edit on close and reopened it with its checklist preference.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
