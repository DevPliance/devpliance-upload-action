# DevPliance Upload Action

A GitHub Action that uploads your `.devpliance/` compliance evidence to DevPliance from CI/CD.

It does exactly what the `devpliance` CLI's `devpliance submit` does: packages the evidence
directory into a `.tar.gz` in memory and uploads it (multipart) to `POST /api/v1/submissions`,
authenticated with your repository API key. The server parses each `controls/<id>.md` file
(frontmatter metadata + sections) and stores the declared control state; the action reports the
control ids it captured.

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
npm install
npm run build   # bundles src/main.ts -> dist/index.js with @vercel/ncc
```

The action runs from the committed `dist/`, so commit the rebuilt bundle whenever `src/` changes
(CI enforces this).
