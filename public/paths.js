// Resolve from the module, including when the app is mounted below /hackmon/.
export const base = (import.meta.url.startsWith('file:') ? '/' : new URL('.', import.meta.url).pathname);
export const appPath = value => base + value.replace(/^\//, '');
