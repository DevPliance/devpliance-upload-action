// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'

const require = createRequire(import.meta.url)
const repository = require('./repository.js')
const client = require('./client.js')
const { run, apiOrigin, validResult } = require('./index.js')
const core = require('@actions/core')
const github = require('@actions/github')
const RUN_ID = '11111111-1111-4111-8111-111111111111'
const temporary = []

afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of temporary.splice(0)) {
        if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('devpliance-review-'))
            throw new Error('Unexpected cleanup target')
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function response(body, status = 200) {
    return { ok: status < 400, status, json: async () => body }
}

describe('committed evidence', () => {
    it('archives the exact commit and rejects paths or symlinks outside the selected regular files', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpliance-review-'))
        temporary.push(dir)
        git(dir, 'init')
        fs.mkdirSync(path.join(dir, '.devpliance'))
        fs.writeFileSync(path.join(dir, '.devpliance', 'evidence.md'), 'committed evidence')
        git(dir, 'add', '.')
        git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture')
        const sha = git(dir, 'rev-parse', 'HEAD')
        fs.writeFileSync(path.join(dir, '.devpliance', 'evidence.md'), 'uncommitted secret')
        const tree = repository.tree(sha, dir)
        const archive = repository.archive(sha, tree, ['.devpliance/evidence.md'], dir)
        expect(new AdmZip(archive.zip).readAsText('.devpliance/evidence.md')).toBe('committed evidence')
        expect(() => repository.archive(sha, tree, ['.env'], dir)).toThrow(/regular files/)
        expect(() => repository.archive(sha, [{ path: 'link', mode: '120000', type: 'blob' }], ['link'], dir)).toThrow(/symlinks/)
    })
})

describe('retained-run client contract', () => {
    it('uploads base/head commits and polls the returned run ID', async () => {
        const fetchFn = vi.fn().mockResolvedValue(response({ runId: RUN_ID }))
        await client.submit('https://tenant.example', 'dp_key_test', Buffer.from('head'), 'b'.repeat(40),
            Buffer.from('base'), 'a'.repeat(40), fetchFn)
        const [url, options] = fetchFn.mock.calls[0]
        expect(url).toBe('https://tenant.example/api/v1/submissions')
        expect(options.body.get('sha')).toBe('b'.repeat(40))
        expect(options.body.get('base_sha')).toBe('a'.repeat(40))
        expect(options.body.get('base_evidence')).toBeTruthy()
        const pollFetch = vi.fn().mockResolvedValue(response({ runId: RUN_ID, status: 'complete', result: 'fail' }))
        await client.poll('https://tenant.example', 'dp_key_test', RUN_ID, 100, 1000, pollFetch)
        expect(pollFetch.mock.calls[0][0]).toBe('https://tenant.example/api/v1/submissions/runs/' + RUN_ID)
    })

    it('rejects a response for a different retry and malformed passing results', async () => {
        const fetchFn = vi.fn().mockResolvedValue(response({ runId: 'another-run', status: 'complete', result: 'pass' }))
        await expect(client.poll('https://tenant.example', 'key', RUN_ID, 100, 1000, fetchFn)).rejects.toThrow(/different review/)
        expect(validResult({ mode: 'enforce', status: 'complete', result: 'pass', failingControls: ['A.8.9'] })).toBeFalsy()
        expect(validResult({ mode: 'unknown', status: 'complete', result: 'pass', failingControls: [] })).toBeFalsy()
        expect(() => apiOrigin('http://public.example')).toThrow(/HTTPS/)
        expect(() => apiOrigin('https://user:password@tenant.example')).toThrow(/credentials/)
    })
})

function arrangeRun({ mode = 'enforce', result = 'fail', dryRun = false, failOnNonCompliance = 'true' } = {}) {
    const inputs = { 'api-url': 'https://tenant.example', 'api-key': 'dp_key_test', 'dry-run': String(dryRun), 'fail-on-non-compliance': failOnNonCompliance }
    vi.spyOn(core, 'getInput').mockImplementation(name => inputs[name] || '')
    vi.spyOn(core, 'setSecret').mockImplementation(() => {})
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'warning').mockImplementation(() => {})
    vi.spyOn(core, 'setFailed').mockImplementation(() => {})
    vi.spyOn(core, 'setOutput').mockImplementation(() => {})
    vi.spyOn(core.summary, 'addRaw').mockReturnValue(core.summary)
    vi.spyOn(core.summary, 'addLink').mockReturnValue(core.summary)
    vi.spyOn(core.summary, 'write').mockResolvedValue(core.summary)
    github.context.sha = 'b'.repeat(40)
    github.context.payload = { pull_request: { head: { sha: 'b'.repeat(40) }, base: { sha: 'a'.repeat(40) } } }
    vi.spyOn(repository, 'tree').mockReturnValue([{ path: '.devpliance/evidence.md' }])
    vi.spyOn(repository, 'policy').mockReturnValue('policy')
    vi.spyOn(repository, 'archive').mockReturnValue({ zip: Buffer.from('archive'), manifest: [{ path: '.devpliance/evidence.md', bytes: 8 }] })
    vi.spyOn(client, 'preview').mockResolvedValue({ paths: ['.devpliance/evidence.md'], controls: ['A.8.9'], mode })
    vi.spyOn(client, 'submit').mockResolvedValue({ runId: RUN_ID, repository: 'repo-id' })
    vi.spyOn(client, 'poll').mockResolvedValue({ runId: RUN_ID, status: 'complete', result, mode, failingControls: result === 'pass' ? [] : ['A.8.9'] })
}

describe('Action policy enforcement and preview', () => {
    it('fails an enforced gap and uses PR head/base rather than a merge SHA', async () => {
        arrangeRun()
        await run()
        expect(core.setFailed).toHaveBeenCalled()
        expect(client.preview).toHaveBeenCalledWith('https://tenant.example', 'dp_key_test',
            expect.objectContaining({ baseSha: 'a'.repeat(40), basePolicy: 'policy' }))
        expect(core.setOutput).toHaveBeenCalledWith('run-id', RUN_ID)
    })

    it('includes CODEOWNERS in legacy preview candidates for ownership suggestions', async () => {
        arrangeRun()
        repository.policy.mockReturnValue(null)
        repository.tree.mockReturnValue([{ path: '.devpliance/evidence.md' }, { path: '.github/CODEOWNERS' }, { path: '.env' }])
        await run()
        expect(client.preview).toHaveBeenCalledWith('https://tenant.example', 'dp_key_test',
            expect.objectContaining({ paths: ['.devpliance/evidence.md', '.github/CODEOWNERS'] }))
    })

    it('cannot weaken an explicit base policy through the legacy workflow input', async () => {
        arrangeRun({ failOnNonCompliance: 'false' })
        await run()
        expect(core.setFailed).toHaveBeenCalled()
    })

    it('keeps a failed result visible in reporting mode without blocking', async () => {
        arrangeRun({ mode: 'report' })
        await run()
        expect(core.setFailed).not.toHaveBeenCalled()
        expect(core.setOutput).toHaveBeenCalledWith('result', 'fail')
        expect(core.warning).toHaveBeenCalled()
    })

    it.each(['report', 'enforce'])('handles a polling outage in %s mode', async mode => {
        arrangeRun({ mode })
        client.poll.mockRejectedValue(new Error('Review timed out'))
        await run()
        expect(core.setOutput).toHaveBeenCalledWith('result', 'unavailable')
        if (mode === 'report') {
            expect(core.setFailed).not.toHaveBeenCalled()
            expect(core.warning).toHaveBeenCalled()
        } else expect(core.setFailed).toHaveBeenCalled()
    })

    it('never uploads or starts an AI review during dry run', async () => {
        arrangeRun({ dryRun: true })
        await run()
        expect(client.submit).not.toHaveBeenCalled()
        expect(client.poll).not.toHaveBeenCalled()
        expect(core.setOutput).toHaveBeenCalledWith('result', 'preview')
    })
})

