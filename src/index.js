const core = require('@actions/core');
const github = require('@actions/github');
const client = require('./client');
const repository = require('./repository');

function apiOrigin(raw) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname))
    throw new Error('api-url must be the instance origin, without credentials, a query or a path.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    throw new Error('Use HTTPS for the Devpliance instance.');
  return url.origin;
}

function validResult(result) {
  return ['report', 'enforce'].includes(result.mode)
    && ['complete', 'unavailable'].includes(result.status)
    && Array.isArray(result.failingControls)
    && result.failingControls.every(id => typeof id === 'string')
    && (result.status !== 'complete' || ['pass', 'fail'].includes(result.result))
    && !(result.result === 'pass' && result.failingControls.length);
}

async function run() {
  let mode = null;
  try {
    const apiUrl = apiOrigin(core.getInput('api-url', { required: true }));
    const key = core.getInput('api-key', { required: true });
    core.setSecret(key);
    const payload = github.context.payload || {};
    const sha = payload.pull_request?.head.sha || github.context.sha;
    const baseSha = payload.pull_request?.base.sha || null;
    repository.requireSha(sha);
    if (baseSha) repository.requireSha(baseSha);
    const headTree = repository.tree(sha);
    const headPolicy = repository.policy(sha, headTree);
    const baseTree = baseSha ? repository.tree(baseSha) : null;
    const basePolicy = baseSha ? repository.policy(baseSha, baseTree) : null;
    const evidenceDir = (core.getInput('evidence-dir') || '.devpliance').replace(/\/$/, '');
    const legacy = (baseSha ? basePolicy : headPolicy) == null;
    const candidates = entries => entries.map(entry => entry.path)
      .filter(path => !legacy || path.startsWith(evidenceDir + '/') || repository.CODEOWNERS_PATHS.includes(path));
    const selection = await client.preview(apiUrl, key, {
      paths: candidates(headTree), policy: headPolicy, baseSha, basePolicy,
    });
    const head = repository.archive(sha, headTree, selection.paths);
    core.info('Selected committed files (paths and sizes only):');
    head.manifest.forEach(file => core.info(`${file.path}: ${file.bytes} bytes`));
    mode = selection.mode;
    core.info(`Controls: ${selection.controls.join(', ')}. Mode: ${selection.mode}.`);
    if (!head.manifest.some(file => file.path !== repository.POLICY_PATH)) throw new Error('No evidence matches the policy. Commit evidence or correct the selected paths.');
    if (core.getInput('dry-run') === 'true') {
      core.setOutput('result', 'preview');
      core.info('Preview complete. No evidence archive was uploaded and no AI review was requested.');
      return;
    }
    let baseZip;
    if (baseSha) {
      const baseSelection = await client.preview(apiUrl, key, { paths: candidates(baseTree), policy: basePolicy });
      baseZip = repository.archive(baseSha, baseTree, baseSelection.paths).zip;
    }
    const submitted = await client.submit(apiUrl, key, head.zip, sha, baseZip, baseSha);
    const reviewUrl = apiUrl + `/pipeline?repo=${encodeURIComponent(submitted.repository || '')}&run=${submitted.runId}`;
    const interval = Number(core.getInput('poll-interval-ms') || 5000);
    const timeout = Number(core.getInput('poll-timeout-ms') || 300000);
    if (!Number.isFinite(interval) || interval < 100 || !Number.isFinite(timeout) || timeout < interval)
      throw new Error('Polling values must be positive milliseconds; timeout must exceed the polling interval.');
    core.setOutput('run-id', submitted.runId);
    const result = await client.poll(apiUrl, key, submitted.runId, interval, timeout);
    if (!validResult(result)) throw new Error('The server did not return a valid policy review. No passing result was accepted.');
    core.setOutput('result', result.status === 'complete' ? result.result : 'unavailable');
    core.setOutput('failing-controls', result.failingControls.join(','));
    core.setOutput('review-url', reviewUrl);
    await core.summary.addRaw(result.summary || 'Open the retained run for evidence and suggested corrections.')
      .addLink('Open the retained review', reviewUrl).write();
    const enforce = result.mode === 'enforce' && (!legacy || core.getInput('fail-on-non-compliance') !== 'false');
    if (result.status !== 'complete' || result.result !== 'pass') {
      const message = 'Review needs attention. Inspect the retained run; an unavailable or incomplete review is not a pass.';
      if (enforce) core.setFailed(message); else core.warning(message + ' Reporting mode is enabled.');
    } else core.info('The model rated the selected evidence sufficient. Human review is still required for reviewed export.');
  } catch (error) {
    core.setOutput('result', 'unavailable');
    // A committed policy in reporting mode says findings must not block CI, and an outage, a poll
    // timeout or an invalid response is not a finding. Failures raised before the policy was read
    // still fail the job: the mode is unknown then, and a setup error is not a review outcome.
    if (mode === 'report') core.warning(error.message + ' Reporting mode is enabled, so this does not fail the job.');
    else core.setFailed(error.message);
  }
}

module.exports = { run, apiOrigin, validResult };
if (require.main === module) run();

