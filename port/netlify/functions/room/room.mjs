// G7: the room-code signaling server (Netlify Function v2 at /api/room) on Netlify Blobs; the logic is core.mjs.
// Deployed by tools/deploy_web.sh (orchestrator D14, 2026-11-02). Needs @netlify/blobs (port/netlify/package.json),
// installed by the deploy step in its staging dir, not in this repo. Tests run core.mjs locally
// (tools/roomserver.mjs); tests/web_link_live.cjs uses the live server briefly.
import { getStore } from '@netlify/blobs';
import { httpHandle } from './core.mjs';

function blobStore() {
  const s = getStore({ name: 'golden-sun-rooms', consistency: 'strong' });
  return {
    async read(k) { const r = await s.getWithMetadata(k, { type: 'json', consistency: 'strong' }); return r ? { data: r.data, etag: r.etag } : null; },
    async write(k, data, o) { const r = await s.setJSON(k, data, o.isNew ? { onlyIfNew: true } : { onlyIfMatch: o.etag }); return r ? r.modified !== false : true; },
    async del(k) { await s.delete(k); },
    async keys() { return (await s.list()).blobs.map((b) => b.key); },
  };
}

export default async (req, context) => httpHandle(req, blobStore(), context && context.ip);
export const config = { path: '/api/room' };
