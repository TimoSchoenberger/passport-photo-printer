# Contributing

Thanks for helping improve Passport Photo Printer. Bug reports, documentation
improvements, accessibility fixes, translations, and focused feature proposals
are welcome.

## Before opening an issue

- Search existing issues first.
- Use GitHub's private vulnerability reporting for security problems.
- Keep feature requests aligned with the project's goal: a small, self-hosted
  crop-and-print tool without biometric or passport-compliance claims.

## Development setup

Install Node.js 24 or newer, then run:

```sh
npm ci
npm run dev
```

Before submitting a pull request, run the same checks as CI:

```sh
npm run check
npm test
npm run build
docker build -t passport-photo-printer:test .
```

The browser integration check uses an original, generated HEIC fixture and a
simulated camera. On Linux, install its Python dependencies and Chromium, then
run it against the freshly built app:

```sh
python3 -m venv .venv
.venv/bin/pip install -r tests/requirements-browser.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python tests/run-browser-check.py
```

On Windows, the test uses installed Microsoft Edge instead of downloaded
Chromium. The fixture can be regenerated with
`python tests/create-heic-fixture.py` after installing `pillow-heif`.

## Pull requests

- Keep changes focused and explain the user-facing reason for them.
- Add or update tests for behavior changes.
- Update documentation and `.env.example` when configuration changes.
- Do not commit real photos, API keys, `.env` files, or generated exports.
- Preserve accessible labels, keyboard operation, responsive layouts, and
  exact physical print dimensions.

By contributing, you agree that your contribution is licensed under the MIT
License included in this repository.
