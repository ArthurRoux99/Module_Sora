/**
 * Shim du runtime Sora / ShiroX pour exécution locale sous Node.
 *
 * Reproduit fidèlement les globals que l'app expose aux modules :
 *   - fetchv2(url, headers, method, body, redirect, encoding)
 *   - fetch(url, options)            (fallback utilisé par certains modules)
 *   - console.log(single_arg)        (l'app ne supporte QU'UN argument)
 *
 * Le module est chargé dans un vm.Context isolé : les fonctions déclarées en
 * `async function foo()` deviennent des propriétés du global, exactement comme
 * dans l'app (pas d'export/require).
 */
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Hôtes de télémétrie bloqués par défaut : les modules tiers en embarquent. */
const TELEMETRY_HOSTS = ['supabase.co', 'supabase.in', 'google-analytics.com', 'analytics'];

export class RuntimeStats {
  constructor() {
    /** @type {{method:string,url:string,status:number|null,ms:number,bytes:number,blocked:boolean,error:string|null}[]} */
    this.requests = [];
    /** @type {string[]} */
    this.logs = [];
  }
  get blockedCount() {
    return this.requests.filter((r) => r.blocked).length;
  }
  get failedCount() {
    return this.requests.filter((r) => r.error !== null).length;
  }
}

function decodeBody(buf, headers, encoding) {
  const enc = (headers.get('content-encoding') || '').toLowerCase();
  let out = buf;
  try {
    if (enc.includes('br')) out = brotliDecompressSync(buf);
    else if (enc.includes('gzip')) out = gunzipSync(buf);
    else if (enc.includes('deflate')) out = inflateSync(buf);
  } catch {
    out = buf; // undici a déjà décompressé dans la plupart des cas
  }
  const label = (encoding || 'utf-8').toLowerCase();
  if (label === 'utf-8' || label === 'utf8') return out.toString('utf-8');
  try {
    return new TextDecoder(label).decode(out);
  } catch {
    return out.toString('utf-8');
  }
}

/**
 * Construit une réponse au format attendu par les modules :
 * `.text()`, `.json()`, `.status`, `.ok`, `.headers`.
 */
function wrapResponse(res, bodyText) {
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    url: res.url,
    headers: Object.fromEntries(res.headers.entries()),
    _body: bodyText,
    async text() {
      return this._body;
    },
    async json() {
      return JSON.parse(this._body);
    },
  };
}

export function createSandbox({ stats, allowTelemetry = false, verbose = false, timeoutMs = 20000, paceMs = 0 }) {
  let lastRequestAt = 0;

  /**
   * Espacement optionnel des requêtes (--pace). Certains backends (ex.
   * pp.animex.one) renvoient {"error":"bot_detected"} en 403 sur une rafale,
   * puis re-servent 200 une fois la cadence retombée.
   *
   * NOTE DE FIDÉLITÉ : on n'injecte volontairement PAS de Referer/Origin par
   * défaut. Un module qui les oublie doit échouer ICI comme il échouerait dans
   * Sora, sinon le harness masque le bug au lieu de le révéler.
   */
  async function pace() {
    if (paceMs <= 0) return;
    const wait = paceMs - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  }

  async function doFetch(url, headers = {}, method = 'GET', body = null, _redirect = true, encoding = 'utf-8') {
    await pace();
    const started = Date.now();
    const target = String(url);

    if (!allowTelemetry && TELEMETRY_HOSTS.some((h) => target.includes(h))) {
      stats.requests.push({
        method, url: target, status: null, ms: 0, bytes: 0, blocked: true, error: null,
      });
      if (verbose) console.error(`  [blocked telemetry] ${target}`);
      return wrapResponse({ status: 204, url: target, headers: new Map() }, '');
    }

    const finalHeaders = { 'User-Agent': DEFAULT_UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8', ...headers };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await globalThis.fetch(target, {
        method, headers: finalHeaders,
        body: body === null || body === undefined ? undefined : body,
        redirect: 'follow', signal: ctl.signal,
      });
      const buf = Buffer.from(await res.arrayBuffer());
      const text = decodeBody(buf, res.headers, encoding);
      stats.requests.push({
        method, url: target, status: res.status, ms: Date.now() - started,
        bytes: buf.length, blocked: false, error: null,
      });
      if (verbose) console.error(`  [${res.status}] ${method} ${target} (${buf.length}b, ${Date.now() - started}ms)`);
      return wrapResponse(res, text);
    } catch (e) {
      stats.requests.push({
        method, url: target, status: null, ms: Date.now() - started,
        bytes: 0, blocked: false, error: e.message,
      });
      if (verbose) console.error(`  [ERR] ${method} ${target} :: ${e.message}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const sandbox = {
    fetchv2: doFetch,
    // Le `fetch` de l'app prend (url, options) et retourne la même enveloppe.
    fetch: async (url, options = {}) =>
      doFetch(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null, true, options.encoding ?? 'utf-8'),
    console: {
      log: (...args) => {
        if (args.length > 1) {
          stats.logs.push('[WARN] console.log appelé avec plusieurs arguments — non supporté par Sora');
        }
        const line = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
        stats.logs.push(line);
        if (verbose) console.error('  · ' + line);
      },
      error: (...a) => sandbox.console.log(...a),
      warn: (...a) => sandbox.console.log(...a),
    },
    Buffer, TextDecoder, TextEncoder, URL, URLSearchParams,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, Promise, JSON, Math, Date, RegExp, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, isNaN,
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

/**
 * Charge un module Sora et retourne ses 4 fonctions.
 * @returns {Promise<{fns:Record<string,Function>, stats:RuntimeStats, missing:string[]}>}
 */
export async function loadModule(scriptPath, opts = {}) {
  const code = await readFile(scriptPath, 'utf-8');
  const stats = new RuntimeStats();
  const sandbox = createSandbox({ stats, ...opts });
  const ctx = vm.createContext(sandbox);
  new vm.Script(code, { filename: scriptPath }).runInContext(ctx, { timeout: 10000 });

  const required = ['searchResults', 'extractDetails', 'extractEpisodes', 'extractStreamUrl'];
  const fns = {};
  const missing = [];
  for (const name of required) {
    if (typeof sandbox[name] === 'function') fns[name] = sandbox[name];
    else missing.push(name);
  }
  return { fns, stats, missing, sandbox };
}
