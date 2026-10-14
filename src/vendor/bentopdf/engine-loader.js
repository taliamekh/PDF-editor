import createModule from 'bentopdf-pdfium';

const inBrowser = typeof window !== 'undefined';

let ENGINE_VERSION = 'dev';
try {
  ENGINE_VERSION = __ENGINE_VERSION__;
} catch {
  ENGINE_VERSION = 'dev';
}

function resolveWasmUrl() {
  if (inBrowser) {
    const url = new URL('./editcore.wasm', import.meta.url);
    if (import.meta.env?.DEV) {
      url.searchParams.set('v', ENGINE_VERSION);
    }
    return url.href;
  }
  return new URL('./editcore.wasm', import.meta.url).href;
}

const wasmUrl = resolveWasmUrl();

export const ENGINE_BUILD = `bentopdf-pdfium@${ENGINE_VERSION}`;

export function createEngineModule(options) {
  return createModule({
    ...(options ?? {}),
    locateFile: (file, prefix) =>
      file.endsWith('.wasm')
        ? (wasmUrl ?? `${prefix}editcore.wasm`)
        : `${prefix}${file}`,
  });
}
