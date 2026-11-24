// Preloaded via NODE_OPTIONS=--import; maps URL -> {status, body} from the JSON file in STUB_FILE.
import { readFileSync } from 'node:fs';
const real = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const map = JSON.parse(readFileSync(process.env.STUB_FILE, 'utf8'));
  const hit = map[String(url)];
  if (!hit) return new Response('not stubbed', { status: 599 });
  return new Response(typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body), { status: hit.status ?? 200 });
};
