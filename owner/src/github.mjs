// Minimal GitHub REST client. The token lives only in the Worker's secrets
// (GITHUB_TOKEN: a fine-grained token limited to this one repository with
// Contents: read/write and Actions: read). It is never sent to the browser.

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function toB64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
function fromB64(b64) { return Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)); }

export function github(env) {
  const repo = env.GITHUB_REPO; // "owner/name"
  const branch = env.GITHUB_BRANCH || 'main';
  const api = env.GITHUB_API || 'https://api.github.com';

  async function call(method, path, body) {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'dan-mckenna-homes-owner-editor',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(res.status, `GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.status === 204 ? {} : res.json();
  }

  return {
    async getFile(path) {
      const r = await call('GET', `/repos/${repo}/contents/${encodeURI(path)}?ref=${branch}`);
      if (!r || Array.isArray(r)) return null;
      return { sha: r.sha, bytes: fromB64(r.content || '') };
    },
    async getText(path) {
      const f = await this.getFile(path);
      return f ? new TextDecoder().decode(f.bytes) : null;
    },
    async listDir(path) {
      const r = await call('GET', `/repos/${repo}/contents/${encodeURI(path)}?ref=${branch}`);
      return Array.isArray(r) ? r.map((x) => ({ path: x.path, name: x.name, type: x.type })) : [];
    },
    /**
     * Make one commit with several file changes. content: string | Uint8Array | null (delete).
     * Uses a non-forced ref update so a concurrent change is never overwritten; on a race we
     * rebuild on top of the new head (callers pass a function so content can be recomputed).
     */
    async commit(message, buildChanges, { retries = 3 } = {}) {
      for (let attempt = 0; ; attempt++) {
        const ref = await call('GET', `/repos/${repo}/git/ref/heads/${branch}`);
        const headSha = ref.object.sha;
        const head = await call('GET', `/repos/${repo}/git/commits/${headSha}`);
        const changes = await buildChanges();
        const tree = [];
        for (const c of changes) {
          if (c.content === null) { tree.push({ path: c.path, mode: '100644', type: 'blob', sha: null }); continue; }
          const bytes = typeof c.content === 'string' ? new TextEncoder().encode(c.content) : c.content;
          const blob = await call('POST', `/repos/${repo}/git/blobs`, { content: toB64(bytes), encoding: 'base64' });
          tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
        }
        const newTree = await call('POST', `/repos/${repo}/git/trees`, { base_tree: head.tree.sha, tree });
        if (newTree.sha === head.tree.sha) return { sha: headSha, unchanged: true };
        const commit = await call('POST', `/repos/${repo}/git/commits`, { message, tree: newTree.sha, parents: [headSha] });
        try {
          await call('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
          return { sha: commit.sha };
        } catch (e) {
          if (e.status === 422 && attempt < retries) continue; // someone else pushed first; redo on top
          throw e;
        }
      }
    },
    /** State of the publish workflow for a commit: 'running' | 'success' | 'failure' | 'unknown'. */
    async workflowState(sha) {
      const r = await call('GET', `/repos/${repo}/actions/runs?head_sha=${sha}&per_page=5`);
      const runs = r?.workflow_runs || [];
      if (!runs.length) return 'unknown';
      if (runs.some((x) => x.status !== 'completed')) return 'running';
      return runs.every((x) => x.conclusion === 'success') ? 'success' : 'failure';
    },
    async rerun(sha) {
      const r = await call('GET', `/repos/${repo}/actions/runs?head_sha=${sha}&per_page=5`);
      for (const run of r?.workflow_runs || []) if (run.conclusion && run.conclusion !== 'success') await call('POST', `/repos/${repo}/actions/runs/${run.id}/rerun-failed-jobs`);
    },
  };
}
