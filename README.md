# DevPliance Upload Action

A monorepo containing the **`devpliance` CLI** and a **GitHub Action** that uploads your
`.devpliance/` compliance evidence to DevPliance from CI/CD.

- **`cli/`** — the `devpliance` CLI package (`login`, `init`, `submit`, …). Its own npm-publishable
  package; the source of truth for the archive/upload logic.
- **root** — the GitHub Action. It imports the CLI package (`devpliance/archive`) and does exactly
  what `devpliance submit` does — packages the evidence dir into a `.tar.gz` and uploads it
  (multipart) to `POST /api/v1/submissions`. The server parses each `controls/<id>.md`
  (frontmatter metadata + sections) and stores the declared control state; the action reports the
  control ids captured. No copy — one implementation, shared.

## Usage

```yaml
name: DevPliance
on:
  push:
    branches: [main]

jobs:
  upload-evidence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: DevPliance/devpliance-upload-action@v1
        with:
          api-url: https://acme.devpliance.com          # your DevPliance instance
          api-key: ${{ secrets.DEVPLIANCE_API_KEY }}    # from the dashboard: Register Repository / Rotate API key
```

## Inputs

| Input          | Required | Default       | Description |
| -------------- | -------- | ------------- | ----------- |
| `api-url`      | yes      | —             | Your DevPliance instance base URL, e.g. `https://acme.devpliance.com`. |
| `api-key`      | yes      | —             | Repository API key (`dp_key_…`) from the DevPliance dashboard. Store it as a secret. |
| `evidence-dir` | no       | `.devpliance` | Path to the evidence directory to upload. |

## Outputs

| Output            | Description |
| ----------------- | ----------- |
| `controls`        | Comma-separated control ids captured from the upload. |
| `controls-parsed` | Number of controls captured. |

## Development

```bash
npm install       # installs the workspace (root action + cli/ package)
npm run build     # builds cli/ (tsc), then bundles the action -> dist/index.js with @vercel/ncc
```

The action runs from the committed `dist/`, so commit the rebuilt bundle whenever `src/` or the CLI
changes (CI enforces this). `cli/dist/` is a build artifact and is not committed.

To publish the CLI to npm: `cd cli && npm publish` (after `npm run build`).
