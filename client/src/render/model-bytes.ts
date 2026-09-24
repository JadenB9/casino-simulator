// A model file's bytes. The site's CDN sends .glb files as they are (it doesn't compress model
// files), and the characters' vertex data packs to a third of its size, so a published build carries
// every model gzipped beside it (client/vite.config.ts writes `<name>.glb.gz`) and the browser unpacks
// it here: two megabytes of models become under one on the way to the loading screen. The dev server
// and a browser without DecompressionStream fetch the plain file.

const PACKED = import.meta.env.PROD && typeof DecompressionStream === 'function';

async function ok(res: Promise<Response>, url: string): Promise<Response> {
  const r = await res;
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r;
}

export async function modelBytes(url: string): Promise<ArrayBuffer> {
  if (!PACKED) return (await ok(fetch(url), url)).arrayBuffer();
  const raw = await (await ok(fetch(`${url}.gz`), url)).arrayBuffer();
  // Unpack only what is still gzipped: a server that sent it with Content-Encoding has already
  // handed the browser's decoder the job.
  const head = new Uint8Array(raw, 0, Math.min(2, raw.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return raw;
  return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
