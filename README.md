# Veloce

**AI-first, open-source presentation engine.** AI agents build professional, animated decks
through an MCP server; humans edit the very same deck by hand, even at the same time.
Runs on Linux, Windows and macOS. Decks are saved as `.veloce` files.

> 🚧 Early development: see [docs/ROADMAP.md](docs/ROADMAP.md) for where things stand.

## Why Veloce

- **AI-first, not AI-bolted-on:** the editor and AI agents use the exact same operations.
- **Animated by design:** one deterministic timeline drives everything, from text reveals to 3D scenes.
- **Extensible:** charts, Lottie, Rive, Three.js and more come from plugins that follow a single contract.
- **Your own format:** `.veloce` files are open, versioned and portable. PPTX is just an import/export option.

## Repository layout

| Path                  | What lives there                                                         |
| --------------------- | ------------------------------------------------------------------------ |
| `packages/core`       | Deck schema, ops, transactions, undo, theme tokens, lint rules (pure TS) |
| `packages/format`     | `.veloce` file read/write, assets, migrations                            |
| `packages/plugin-api` | Plugin contract, registry, conformance kit                               |
| `packages/renderer`   | Deck → DOM rendering, timeline clock, measurement                        |
| `packages/doc-server` | Document ownership, transactions, sync, autosave                         |
| `packages/mcp`        | MCP tools/resources for AI agents                                        |
| `apps/editor`         | The editor web app                                                       |
| `apps/server`         | Standalone doc-server + MCP (web/dev)                                    |
| `apps/desktop`        | Electron desktop app                                                     |
| `plugins/*`           | Element-type plugins (built-in and official)                             |

Architecture decisions and their reasons: [docs/DECISIONS.md](docs/DECISIONS.md).

## Development

Requires **Node 22+** and **pnpm** (version pinned in `package.json`).

```sh
pnpm install
pnpm check       # lint + typecheck + test, the same as CI
pnpm build       # compile all packages (tsc -b)
pnpm test        # run tests (Vitest, no build needed)
pnpm test:watch
pnpm format      # auto-fix formatting & import order (Biome)
```

`scripts/architecture.test.ts` enforces the package dependency graph. If it fails, either fix
the import or (if the architecture changed on purpose) update it and record a decision.

## License

[Apache License 2.0](LICENSE)
