# Devpliance CLI and retained-review Action

This monorepo contains the `devpliance` CLI and the canonical GitHub Action used to review
policy-selected, committed repository evidence in Devpliance.

- `cli/` scaffolds and submits `.devpliance/` evidence for the legacy declaration workflow.
- The repository root is the retained-review GitHub Action. It previews the committed policy,
  uploads the exact head and optional pull-request base commits, polls the retained run, and links
  CI back to the review and export screen.

## GitHub Action usage

Register the repository in Devpliance, save its repository key as the Actions secret
`DEVPLIANCE_API_KEY`, and pin the Action to a full released commit SHA:

```yaml
name: Devpliance evidence review
on: [push, pull_request, workflow_dispatch]

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          fetch-depth: 0
      - uses: devpliance/devpliance-upload-action@REPLACE_WITH_FULL_COMMIT_SHA
        with:
          api-url: https://your-instance.devpliance.com
          api-key: ${{ secrets.DEVPLIANCE_API_KEY }}
```

The Action reads files from committed Git objects; uncommitted files, symlinks, and submodules are
not uploaded as evidence. With `.devpliance/policy.yml`, the committed policy selects controls,
evidence paths, and `report` or `enforce` mode. Without a policy, `evidence-dir` is the legacy
fallback selection.

Use `dry-run: true` to preview selected paths without uploading an archive or starting an AI review.

### Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `api-url` | yes | — | Devpliance instance origin. |
| `api-key` | yes | — | Repository API key. |
| `evidence-dir` | no | `.devpliance` | Legacy fallback evidence directory. |
| `dry-run` | no | `false` | Preview without uploading or reviewing. |
| `fail-on-non-compliance` | no | `true` | Legacy fallback enforcement; an explicit policy wins. |
| `poll-interval-ms` | no | `5000` | Review polling interval. |
| `poll-timeout-ms` | no | `300000` | Maximum time to wait for a result. |

### Outputs

| Output | Description |
| --- | --- |
| `result` | `pass`, `fail`, `unavailable`, or `preview`. |
| `failing-controls` | Comma-separated controls needing attention. |
| `run-id` | Retained review identifier. |
| `review-url` | Link to the retained review. |

## Development

```bash
npm ci
npm test
npm run build
```

`npm run build` compiles the CLI and rebuilds the committed `dist/index.js` Action bundle. Commit
the bundle whenever Action source or dependencies change.

The canonical CLI source lives under `cli/`. To test it globally, build it and run `npm link` from
that directory. See `cli/README.md` for the full CLI workflow.
