# Security Policy

## Do not publish secrets

Never commit or attach any of the following to an issue or pull request:

- `.env`
- `data/`
- `data/master.key`
- `data/admin-password.txt`
- `data/mcp-token.txt`
- `data/onestaff.db`
- API keys, workspace keys, bearer tokens, cookies, QR payloads, or uploaded user files

The repository `.gitignore` excludes the normal runtime locations, but ignore rules are not a substitute for checking `git status` before every push.

## Reporting a vulnerability

Please avoid posting exploitable details or credentials in a public issue. Contact the project maintainer through the feedback address documented in the application/README and include only the minimum information needed to reproduce the issue. Redact all credentials and personal data.

If a credential is ever committed, remove it from use and rotate/revoke it immediately. Deleting a later commit does not make an exposed credential safe again.
