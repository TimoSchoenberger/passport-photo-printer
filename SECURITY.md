# Security policy

## Supported versions

Security fixes are made on the latest release and on the `main` branch. Users
should update to the newest container tag or pin the newest published version.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/TimoSchoenberger/passport-photo-printer/security/advisories/new)
so details remain private while the report is investigated.

Include the affected version or image digest, deployment details relevant to
the issue, reproduction steps, and potential impact. You should receive an
initial response within seven days. If the report is accepted, remediation and
disclosure timing will be coordinated with you.

## Deployment scope

This app has no built-in authentication. Keep it on a trusted network or put an
authenticated reverse proxy in front of it. Treat the configured Immich API key
as a secret and grant only `asset.upload`, `tag.create`, and `tag.asset`.
