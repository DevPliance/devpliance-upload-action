# DevPlace Upload Action

A GitHub Action to upload data to your [DevPlace](#) app directly from CI/CD.

> **Status:** early scaffold. Right now this action just reads the `message`
> input and prints it out / returns it as an output. The real HTTP upload to
> the DevPlace API will replace the placeholder logic in `src/main.ts`.

## Usage

```yaml
- uses: your-org/devplace-upload-action@v1
  with:
    message: 'Hello from CI!'
    # api-key: ${{ secrets.DEVPLACE_API_KEY }}   # not used yet
```

## Inputs

| Name      | Required | Default                | Description                              |
|-----------|----------|-------------------------|-------------------------------------------|
| `message` | Yes      | `Hello from DevPlace!`  | Placeholder input, will become the upload payload |
| `api-key` | No       | —                        | Reserved for authenticating the real upload |

## Outputs

| Name     | Description                          |
|----------|---------------------------------------|
| `result` | Echoes back the `message` input       |

## Development

```bash
npm install
npm run build   # bundles src/main.ts -> dist/index.js via @vercel/ncc
```

`dist/index.js` is what GitHub Actions actually runs — it must be rebuilt
and committed before every release, since Actions does not run an install/build
step for you.

### Local smoke test

```bash
INPUT_MESSAGE="test" node dist/index.js
```

## Releasing

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0

# Move the floating major tag so consumers can pin to `@v0`
git tag -fa v0 -m "Update v0 tag"
git push origin v0 --force
```
