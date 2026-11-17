const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const local = path.resolve('output/tauri-toolchain');
if (fs.existsSync(path.join(local, 'cargo/bin/cargo.exe'))) {
  process.env.CARGO_HOME = path.join(local, 'cargo');
  process.env.RUSTUP_HOME = path.join(local, 'rustup');
  process.env.PATH =
    path.join(local, 'cargo/bin') + path.delimiter + process.env.PATH;
}
const args = process.argv.slice(2);
const result =
  args[0] === 'test'
    ? spawnSync(
        'cargo',
        [
          'test',
          '--locked',
          '--manifest-path',
          'src-tauri/Cargo.toml',
          ...args.slice(1),
        ],
        { stdio: 'inherit' },
      )
    : spawnSync(
        process.execPath,
        [require.resolve('@tauri-apps/cli/tauri.js'), ...args],
        { stdio: 'inherit' },
      );
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
