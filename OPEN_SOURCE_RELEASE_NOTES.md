# GitHub Open-Source Release Notes

This source-release package was prepared from a local runnable copy and intentionally excludes local runtime state.

## Removed from the public release

- `.env`
- `data/` including administrator password, MCP token, encryption master key, SQLite database, uploads, and generated artifacts
- `node_modules/`
- local startup diagnostics
- stale checksums generated for the private/runtime package
- bundled font binary (use `PDF_FONT` or a system-installed compatible Chinese font)

## Added for public hosting

- `.gitignore`
- `.gitattributes`
- `LICENSE` (Apache-2.0 for source code)
- `NOTICE`
- `ASSETS_LICENSE.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- GitHub Actions CI workflow

Before publishing, run `git status` and make sure no credential, runtime `data/` directory, or private upload is staged.
