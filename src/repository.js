const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const POLICY_PATH = '.devpliance/policy.yml';
const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

function requireSha(sha) {
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(sha || '')) throw new Error('A full commit SHA is required.');
}

function tree(sha, cwd = process.cwd()) {
  requireSha(sha);
  const output = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', sha], {
    cwd, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output.split('\0').filter(Boolean).map(line => {
    const match = line.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/);
    if (!match) throw new Error('Could not read the Git tree.');
    return { mode: match[1], type: match[2], path: match[4] };
  });
}

function read(sha, path, cwd = process.cwd()) {
  requireSha(sha);
  if (path.startsWith('/') || path.split('/').includes('..')) throw new Error('Evidence must stay inside the repository.');
  return execFileSync('git', ['show', sha + ':' + path], {
    cwd, maxBuffer: 2 * 1024 * 1024, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function policy(sha, entries, cwd = process.cwd()) {
  const entry = entries.find(file => file.path === POLICY_PATH);
  if (!entry) return null;
  if (entry.mode === '120000' || entry.type !== 'blob') throw new Error('Repository policy must be a regular committed file.');
  const value = read(sha, POLICY_PATH, cwd);
  if (value.length > 16384) throw new Error('Repository policy must be at most 16 KB.');
  return value.toString('utf8');
}

function archive(sha, entries, selectedPaths, cwd = process.cwd()) {
  if (!Array.isArray(selectedPaths) || selectedPaths.some(path => typeof path !== 'string'))
    throw new Error('The server returned an invalid evidence selection.');
  const available = new Map(entries.map(entry => [entry.path, entry]));
  const zip = new AdmZip();
  let bytes = 0;
  const manifest = [];
  for (const path of [...new Set(selectedPaths)].sort()) {
    const entry = available.get(path);
    if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))
      throw new Error('Selected evidence must be regular files in the submitted commit; symlinks and submodules are not supported.');
    const content = read(sha, path, cwd);
    bytes += content.length;
    if (bytes > MAX_TOTAL_BYTES) throw new Error('Selected evidence exceeds 20 MB. Narrow the repository policy.');
    zip.addFile(path, content);
    manifest.push({ path, bytes: content.length });
  }
  return { zip: zip.toBuffer(), manifest };
}

module.exports = { tree, policy, archive, requireSha, POLICY_PATH, CODEOWNERS_PATHS };

