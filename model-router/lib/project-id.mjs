// Project id: the first 16 hex characters of the SHA-256 of the normalized git remote URL, else of the root path.
// Uses the Web Crypto API (`crypto.subtle`), which both the mod's environment and Node have.

/** A remote URL without scheme, credentials, port, `.git` suffix and case: `host/owner/repo`. */
export function normalizeRemote(url) {
  if (typeof url !== 'string') return null;
  let s = url.trim();
  if (!s) return null;
  // Only a URL with a scheme can name a port; in the scp form `host:1234/repo`, `1234` is the owner.
  const hasScheme = /^[a-z+]+:\/\//i.test(s);
  s = s.replace(/^[a-z+]+:\/\//i, '');
  s = s.replace(/^[^@/]+@/, '');
  if (hasScheme) s = s.replace(/^([^/:]+):\d+\//, '$1/');
  s = s.replace(/^([^/:]+):/, '$1/');
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return s.toLowerCase() || null;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `{ id, root }` for a repository's remote and root, or null when neither is known. */
export async function projectId({ remote, root } = {}) {
  const cleanRoot = typeof root === 'string' && root.trim() ? root.trim().replace(/\/+$/, '') || '/' : null;
  const source = normalizeRemote(remote) ?? cleanRoot;
  if (!source) return null;
  return { id: (await sha256Hex(source)).slice(0, 16), root: cleanRoot };
}
