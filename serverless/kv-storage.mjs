// Arquivos do portfólio sobre Cloudflare KV, com a mesma interface do storage local.
export function createKvStorage(kv) {
  return {
    async upload(path, bytes, opts = {}) {
      await kv.put(path, bytes, { metadata: { type: opts.contentType || 'application/octet-stream' } });
      return { path };
    },
    async download(path) {
      const found = await kv.getWithMetadata(path, 'arrayBuffer');
      if (!found || found.value == null) {
        throw Object.assign(new Error('storage_object_not_found'), { code: 'storage_object_not_found' });
      }
      return new Response(found.value, {
        headers: { 'content-type': found.metadata?.type || 'application/octet-stream' }
      });
    },
    async remove(paths) {
      for (const path of paths) await kv.delete(path);
      return { removed: paths };
    },
    async createSignedUploadUrl(path) {
      return { signedUrl: `/functions/v1/app/__upload/${path}` };
    },
    async createSignedUrl(path) {
      return { signedUrl: `/functions/v1/app/__upload/${path}` };
    }
  };
}
