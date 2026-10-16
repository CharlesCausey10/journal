A daily journal for personal use and development experience

## Local data

The installed app keeps its existing personal database in Electron's default
`userData` directory. Development runs (`npm start`) use a separate
`Journal Development` directory under Electron's `appData` directory instead.
On Windows, the development database is
`%APPDATA%\Journal Development\journal.sqlite`.

The development database is created on its first run with the default blocks.
Existing personal data is not moved or copied. Development window settings and
browser session data are also kept in the separate development directory.
