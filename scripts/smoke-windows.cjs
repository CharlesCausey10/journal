const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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

async function until(get, description) {
  const deadline = Date.now() + 45000;
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
  const child = spawn(exe, [], {
    windowsHide: true,
    env: {
      ...process.env,
      JOURNAL_SMOKE_TEST_DATA: directory,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port,
    },
  });
  let socket;
  try {
    const target = await until(async () => {
      if (child.exitCode !== null)
        throw Error('Journal exited with ' + child.exitCode);
      const response = await fetch(
        'http://127.0.0.1:' + port + '/json/list',
      ).catch(() => null);
      return (
        response &&
        (await response.json()).find((t) =>
          /^https?:\/\/tauri\.localhost/.test(t.url),
        )
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
    await evaluate('setTimeout(() => window.__TAURI__.window.getCurrentWindow().close(), 0); true');
    await until(() => child.exitCode !== null, 'Journal to exit');
    assert.equal(child.exitCode, 0);
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
  fs.writeFileSync(path.resolve('output/test-temp/last-smoke-directory.txt'), directory);
  console.log(
    'Packaged Journal saved an edit on close and reopened it with its checklist preference.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
