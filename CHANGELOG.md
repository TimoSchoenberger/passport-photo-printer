# Changelog

This project follows [Semantic Versioning](https://semver.org/). Changes for
each release will be recorded here.

## [Unreleased]

## [1.0.1] - 2026-09-15

- Harden the static file server against request-path traversal.
- Move the production image to a minimal, non-root distroless runtime.
- Add container startup checks and a blocking high/critical vulnerability gate before publishing.
- Restrict registry and attestation permissions to the publish job.

## [1.0.0] - 2026-09-15

- Initial public release.
- Browser-based crop editor and optional passport positioning guide.
- Exact-size JPEG and PDF print sheets with automatic copy fitting.
- Optional Immich upload with format tags.
- Installable progressive web app and Docker deployment.

[Unreleased]: https://github.com/TimoSchoenberger/passport-photo-printer/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/TimoSchoenberger/passport-photo-printer/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/TimoSchoenberger/passport-photo-printer/releases/tag/v1.0.0
