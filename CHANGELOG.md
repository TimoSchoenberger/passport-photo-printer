# Changelog

This project follows [Semantic Versioning](https://semver.org/). Changes for
each release will be recorded here.

## [Unreleased]

## [1.0.2] - 2026-09-18

- Support HEIC photos via a CSP-compatible decoder with bounded loading errors.
- Add camera capture, using the same optional positioning guide as the crop editor.
- Run Trivy filesystem and container checks in a dedicated workflow so failed
  dependency installation cannot be misreported as a failed scanner run.
- Publish separate filesystem and container SARIF reports using Trivy 0.74.0.

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

[Unreleased]: https://github.com/TimoSchoenberger/passport-photo-printer/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/TimoSchoenberger/passport-photo-printer/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/TimoSchoenberger/passport-photo-printer/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/TimoSchoenberger/passport-photo-printer/releases/tag/v1.0.0
