# devpliance

Collect compliance evidence from your gitops process.

`devpliance` is a small CLI that scaffolds a `.devpliance/` folder in your
repository from a bundled template pack. That folder holds the pack config
and control-catalogue mappings used to collect compliance evidence from your
gitops process and upload it to your system of record for review.

## Installation

```bash
npm install
npm run build
npm link   # optional: makes the `devpliance` command available globally
```

Requires Node.js >= 18.

## Usage

### Authenticate

```bash
devpliance login --instance acme --secret <api-secret>
```

`--instance` is just the subdomain — `acme` logs you in to
`https://acme.devpliance.com`, not a full URL. Omit `--instance`/`--secret`
and you'll be prompted for them (the secret prompt is hidden, like a
password). In non-interactive shells (CI), pass `--secret` or set
`DEVPLIANCE_API_SECRET` instead — `login` will refuse to hang waiting on a TTY
that isn't there.

Credentials are stored once per machine in `~/.devpliance/credentials.json`
(mode `0600`), not per-repo, so a single login works across every project on
the machine — this is separate from the `.devpliance/` scaffold `init`
creates in a repo.

```bash
devpliance whoami   # show the instance you're logged in to (secret masked)
devpliance logout   # remove the stored credentials
```

### Scaffold a repo

Requires being logged in (`devpliance login`) — `init` refuses to run
otherwise.

```bash
devpliance init
```

Scaffolds a `.devpliance/` folder in the current directory by extracting the
template pack bundled with the CLI (`src/assets/devpliance-repo-pack.zip`):

```
.devpliance/
  config/devp.yml   # pack identity, framework/profile, controls in scope
  controls/         # one markdown file per in-scope ISO 27001 Annex A control
```

If `.devpliance/` already exists, `init` will refuse to overwrite it unless
you pass `--force`:

```bash
devpliance init --force
```

Running `devpliance` with no sub-command prints the banner and help text.

### Submit evidence

```bash
devpliance submit
```

Packages the `.devpliance/` folder into a gzip-compressed tar archive
(in memory, nothing written to disk) and uploads it as a multipart POST to
`<base_url>/api/v1/submissions`, authenticated with your stored API secret as
a bearer token. Requires `devpliance login` and a `.devpliance/` folder
(`devpliance init`) — it refuses to run without either.

## Development

```bash
npm run dev     # run the CLI from source with tsx
npm run build   # compile TypeScript to dist/
npm start       # run the compiled CLI from dist/
```

## Format stability

`.devpliance/`'s layout comes from the bundled template pack, which carries
its own `config_version`/`template_version` in `config/devp.yml`. To change
what `init` scaffolds, rebuild that zip — the CLI extracts it verbatim.
