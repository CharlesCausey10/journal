import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { journal, flushJournal } from './desktop';

window.journal = journal;
const root = createRoot(document.getElementById('root') as HTMLElement);
const native = window.__TAURI__.core;
const desktop = window.__TAURI__.window.getCurrentWindow();

// Hidden webviews may suspend frames, so each paint wait has a bounded fallback.
function afterPaint(callback: () => void) {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(fallback);
    callback();
  };
  const fallback = window.setTimeout(finish, 150);
  requestAnimationFrame(() => requestAnimationFrame(finish));
}

window.addEventListener('journal-ready', () => {
  afterPaint(() => {
    void native.invoke('show_ready_window').then(() => {
      // First show the matching solid background, then fade in the loaded content.
      afterPaint(() => {
        document.documentElement.dataset.startupState = 'visible';
        window.dispatchEvent(new Event('journal-visible'));
      });
      return undefined;
    }).catch((error) => {
      document.documentElement.dataset.startupState = 'visible';
      window.dispatchEvent(new Event('journal-visible'));
      console.error(error);
    });
  });
}, { once: true });

function Recovery({ reason }: { reason: string }) {
  useLayoutEffect(() => {
    window.dispatchEvent(new Event('journal-ready'));
  }, []);
  const [message, setMessage] = useState(reason);
  const [busy, setBusy] = useState(false);
  async function recover(action: string) {
    setBusy(true);
    try {
      const restored = await native.invoke('journal_request', {
        action,
        input: null,
      });
      if (restored) location.reload();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main role="alert">
      <h1>Journal could not open your database</h1>
      <p>{message}</p>
      <button disabled={busy} onClick={() => location.reload()}>
        Retry
      </button>
      <button disabled={busy} onClick={() => recover('recovery:folder')}>
        Open data folder
      </button>
      <button disabled={busy} onClick={() => recover('recovery:restore')}>
        Restore backup
      </button>
      <button disabled={busy} onClick={() => desktop.destroy()}>
        Quit
      </button>
    </main>
  );
}

let closing = false;
let update: string | null = null;
void desktop.onCloseRequested(async (event) => {
  event.preventDefault();
  if (closing) return;
  closing = true;
  document.body.inert = true;
  try {
    await flushJournal();
    if (
      update &&
      window.confirm('Install Journal ' + update + ' before closing?')
    ) {
      await native.invoke('apply_update');
    }
    await desktop.destroy();
  } catch (error) {
    window.alert('Journal could not finish closing. ' + String(error));
    document.body.inert = false;
    closing = false;
  }
});
async function start() {
  try {
    await native.invoke('journal_request', { action: 'ready', input: null });
    root.render(<App />);
  } catch (error) {
    root.render(<Recovery reason={String(error)} />);
    return;
  }
  try {
    update = await native.invoke<string | null>('check_update');
  } catch (error) {
    console.warn('Update check failed', error);
  }
}
void start();
