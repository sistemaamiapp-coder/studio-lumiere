// Storage em memória para testes locais da função.
export function createFakeStorage() {
  const files = new Map();
  return {
    files,
    async upload(path, bytes, opts = {}) {
      files.set(path, { bytes, type: opts.contentType || 'application/octet-stream' });
      return { path };
    },
    async download(path) {
      const file = files.get(path);
      if (!file) throw Object.assign(new Error('storage_object_not_found'), { code: 'storage_object_not_found' });
      return new Response(file.bytes, { headers: { 'content-type': file.type } });
    },
    async remove(paths) {
      paths.forEach(path => files.delete(path));
      return { removed: paths };
    },
    async createSignedUploadUrl(path) {
      return { signedUrl: `/functions/v1/app/__upload/${path}` };
    },
    async createSignedUrl(path) {
      return { signedUrl: `/functions/v1/app/__upload/${path}` };
    },
    async list(prefix) {
      return { entries: [...files.keys()].filter(path => path.startsWith(prefix)) };
    }
  };
}
