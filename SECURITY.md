# Security Policy

## Supported versions

Security fixes are made on the latest release. Older releases do not get fixes; please upgrade.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and its impact.

You should get an acknowledgement within 7 days. A fix and a coordinated disclosure date are agreed with you, and you are credited in the release notes unless you prefer otherwise.

## Scope

In scope: the application code in this repository, the Docker image and the compose files.

Out of scope: your own deployment's configuration (weak secrets, a published port, a Cloudflare cache rule on `/photos/*`), third-party services, and denial of service by sheer volume.

## Hardening checklist for operators

- Set `SESSION_SECRET` and `VERIFICATION_PEPPER` to 32 or more random characters, and keep `.env` out of version control.
- Never add `ports:` to the production compose file; only `cloudflared` should reach the app.
- Configure SMTP. Without it, password-reset links are written to the container log.
- Do not cache `/photos/*` at Cloudflare.
- Take regular backups and test a restore (see `docs/deployment.md`).
