const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const ts = require('../.erb/tooling/node_modules/typescript');

const baseline = 'd31ea295ac88adc1c78b9250f85aa087add0e048';
const directory = path.resolve(process.argv[2]);
assert.ok(directory && fs.existsSync(path.join(directory, 'journal.sqlite')));

// Run the exact published Electron database implementation against Node's SQLite
// driver. Desktop integration is stubbed, while the schema and journal logic are real.
class Database {
  constructor(filename, options = {}) {
    this.connection = new DatabaseSync(filename, {
      readOnly: options.readonly ?? false,
    });
  }
  prepare(sql) {
    return this.connection.prepare(sql);
  }
  exec(sql) {
    return this.connection.exec(sql);
  }
  pragma(sql, options = {}) {
    const rows = this.connection.prepare('PRAGMA ' + sql).all();
    return options.simple ? Object.values(rows[0] ?? {})[0] : rows;
  }
  transaction(action) {
    return (...args) => {
      this.exec('BEGIN');
      try {
        const result = action(...args);
        this.exec('COMMIT');
        return result;
      } catch (error) {
        this.exec('ROLLBACK');
        throw error;
      }
    };
  }
  close() {
    this.connection.close();
  }
}
const cache = new Map();
function originalModule(filename) {
  if (cache.has(filename)) return cache.get(filename);
  const source = execFileSync('git', ['show', baseline + ':' + filename], {
    encoding: 'utf8',
  });
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const load = (name) => {
    if (name === 'better-sqlite3') return Database;
    if (name === 'electron')
      return { app: { getPath: () => directory, getVersion: () => '1.1.3' } };
    if (name.startsWith('.'))
      return originalModule(
        path.posix.normalize(
          path.posix.join(path.posix.dirname(filename), name + '.ts'),
        ),
      );
    return require(name);
  };
  vm.runInThisContext(
    '(function(require,module,exports){' + compiled + '\n})',
    { filename },
  )(load, module, module.exports);
  return module.exports;
}
(async () => {
  const app = originalModule('src/main/database.ts');
  await app.initializeDatabase();
  const entries = app.listEntries();
  assert.ok(
    entries.some((entry) =>
      entry.content.includes('Saved when the Journal window closes'),
    ),
  );
  assert.equal(app.getLayoutSettings().fontFamily, 'handlee');
  assert.ok(app.listBlocks().length >= 2);
  const date = new Date();
  const today = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  const saved = app.saveEntry({
    blockId: 1,
    entryDate: today,
    content: 'Written after returning to Electron',
  });
  assert.equal(
    app.getEntry(saved.id).content,
    'Written after returning to Electron',
  );
  app.closeDatabase();
  console.log(
    'Published Electron 1.1.3 opened the exported journal, read its entries/settings, and saved a new entry.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
