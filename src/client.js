const core = require('@actions/core');

async function request(url, apiKey, options = {}, fetchFn = fetch) {
  const response = await fetchFn(url, {
    ...options, headers: { ...options.headers, Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const messages = {
      400: 'Check the commit and upload format.',
      401: 'Check the repository API key.',
      403: 'Check the repository API key and its permissions.',
      404: 'Check the registered repository and deployed Action version.',
      413: 'Reduce the selected evidence.',
      422: 'Correct .devpliance/policy.yml and its evidence paths.',
      429: 'Wait for the repository submission limit to reset.',
    };
    throw new Error(`Devpliance request failed (HTTP ${response.status}). ${messages[response.status] || 'Retry or contact your instance administrator.'}`);
  }
  return response.json();
}

function preview(apiUrl, apiKey, body, fetchFn = fetch) {
  return request(apiUrl + '/api/v1/submissions/preview', apiKey, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, fetchFn);
}

function submit(apiUrl, apiKey, zip, sha, baseZip, baseSha, fetchFn = fetch) {
  const body = new FormData();
  body.append('evidence', new Blob([zip], { type: 'application/zip' }), 'evidence.zip');
  body.append('sha', sha);
  if (baseSha) {
    body.append('base_sha', baseSha);
    body.append('base_evidence', new Blob([baseZip], { type: 'application/zip' }), 'base-evidence.zip');
  }
  // One upload route: /submissions is the review. It used to be /submissions/reviews, while
  // /submissions took the same archive and only recorded declarations — same request, two amounts
  // of judgement, and the caller had to know which it wanted.
  return request(apiUrl + '/api/v1/submissions', apiKey, { method: 'POST', body }, fetchFn);
}

async function poll(apiUrl, apiKey, runId, intervalMs, timeoutMs, fetchFn = fetch) {
  if (!/^[a-f0-9-]{36}$/i.test(runId)) throw new Error('The server did not return a valid run ID.');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await request(apiUrl + '/api/v1/submissions/runs/' + runId, apiKey, {}, fetchFn);
    if (result.runId !== runId) throw new Error('The status response belongs to a different review.');
    if (['complete', 'unavailable'].includes(result.status)) return result;
    if (result.status !== 'processing') throw new Error('The server returned an unknown review state.');
    core.info('Review in progress. No passing result exists yet.');
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
  throw new Error('Review timed out. Open the retained run or retry the workflow; no passing result was returned.');
}

module.exports = { preview, submit, poll };

