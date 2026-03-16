# CLAUDE.md

## Project overview

Glean is a CLI tool that captures web articles as Obsidian notes with AI summaries. It also includes a Raycast extension (`raycast-glean/`) that provides a GUI wrapper around the CLI.

## Tech stack

- **Runtime:** Node.js >= 22, ES modules (`"type": "module"`)
- **CLI parsing:** Commander.js
- **Database:** better-sqlite3 (WAL mode, SQLite)
- **Content extraction:** defuddle (imported as library, not CLI)
- **AI summarisation:** Claude CLI (`claude -p --model <model>`)
- **Testing:** Vitest
- **Linting:** ESLint (flat config)
- **CI:** GitHub Actions (Node 22, lint + test)

## Common commands

```bash
npm test              # run all tests (vitest run)
npm run lint          # eslint .
npm run lint:fix      # eslint . --fix
npx vitest            # watch mode
```

### Raycast extension

```bash
cd raycast-glean
npm run build         # ray build (TypeScript)
npm run dev           # ray develop
npm run lint          # ray lint
```

## Architecture

### Glean CLI (`src/`)

| File | Purpose |
|------|---------|
| `bin/glean.js` | CLI entry point (Commander.js) |
| `src/index.js` | Orchestrator: `glean()` (sync), `gleanAsync()` (async), `spawnWorker()` |
| `src/db.js` | SQLite singleton (`getDb()` / `closeDb()`) |
| `src/queue.js` | Job queue: enqueue, claim, complete, fail, retry, clear, recover |
| `src/worker.js` | Background worker: processes queue, sends macOS notifications |
| `src/extract.js` | defuddle content extraction |
| `src/summarise.js` | Claude CLI integration and prompt |
| `src/note.js` | Markdown/YAML note generation |
| `src/store.js` | Vault file I/O, index management, Base deployment |
| `src/tweet.js` | Tweet composition and X intent URL |
| `src/config.js` | Config loading from `~/.gleanrc.json` |
| `src/utils.js` | URL validation, filename sanitisation |
| `src/commands/` | Subcommands: `status.js`, `retry.js`, `clear.js` |

### Raycast extension (`raycast-glean/`)

Separate TypeScript project. Calls the `glean` CLI binary via shell — shares no runtime code with the CLI.

| File | Purpose |
|------|---------|
| `src/glean-url.ts` | Main "Glean URL" command (no-view mode) |
| `src/queue-status.tsx` | Queue status list view |
| `src/retry-jobs.ts` | Retry failed jobs command |
| `src/clear-jobs.ts` | Clear queue command |
| `src/lib/exec-glean.ts` | Shell execution via login shell (`zsh -l`) |
| `src/lib/url-source.ts` | URL resolution: explicit argument → clipboard |
| `src/lib/config.ts` | Loads `~/.gleanrc.json` for UI defaults |
| `src/lib/types.ts` | TypeScript interfaces |

## Key patterns

### Database singleton (`src/db.js`)

`getDb()` reuses `_instance` when no explicit `dbPath` is passed. Tests call `closeDb()` in `beforeEach`, then `getDb(':memory:')` for isolation. This ensures all queue/worker calls within a test share the same in-memory database.

### Dynamic imports

`bin/glean.js` uses dynamic `import()` for queue and subcommands to avoid loading better-sqlite3 in the synchronous code path.

### Worker spawning

`spawnWorker()` launches a detached Node process (`src/worker.js`). A PID file at `~/.glean/worker.pid` prevents duplicate workers (checked via `process.kill(pid, 0)`).

### Test mocking

- `vi.mock` with `importOriginal` for `fs` — preserves real `readFileSync` while mocking `existsSync`
- `retry.js` accepts `spawnWorkerFn` parameter instead of importing directly (testability)
- Claude CLI, defuddle, and file system are all mocked — tests never hit the network

## Tests

15 test files, 140 tests. All under `test/` with subcommand tests in `test/commands/`.

```bash
npx vitest run        # single run
npx vitest            # watch mode
```
