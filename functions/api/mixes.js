// DJブースのミックス：Mixcloud にアップしたミックスの一覧を JSON で返す（Cloudflare Pages Functions）
// Mixcloud に上げると、最大10分でサイトに出る。Mixcloud の公開APIを使うので APIキーは不要。
const USER = 'えびは'; // Mixcloud のユーザー名（https://www.mixcloud.com/<ここ>/）
const LIMIT = 20;
const TTL = 600; // 秒。この間はキャッシュを返して Mixcloud に取りに行かない

const json = (body, headers = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

export async function onRequest(context) {
  if (!USER) return json({ user: '', mixes: [] }, { 'cache-control': 'no-store' });
  const cache = caches.default;
  const key = new Request(new URL(context.request.url).origin + `/api/mixes?__cache=${USER}`);
  const hit = await cache.match(key);
  if (hit) return withBrowserHeaders(hit);

  let mixes = [];
  try {
    const r = await fetch(`https://api.mixcloud.com/${encodeURIComponent(USER)}/cloudcasts/?limit=${LIMIT}`);
    if (!r.ok) throw new Error('mixcloud ' + r.status);
    const d = await r.json();
    mixes = (d.data || []).map(m => ({
      key: m.key,
      name: m.name,
      url: m.url,
      picture: (m.pictures && (m.pictures['320wx320h'] || m.pictures.medium)) || '',
      length: m.audio_length || 0,
      created: m.created_time || '',
    })).filter(m => typeof m.key === 'string' && m.key.startsWith('/'));
  } catch (err) {
    return json({ error: String(err), mixes: [] }, { 'cache-control': 'no-store' });
  }

  const res = json({ user: USER, mixes }, { 'cache-control': `public, max-age=${TTL}` });
  context.waitUntil(cache.put(key, res.clone()));
  return withBrowserHeaders(res);
}

// ブラウザには毎回聞き直させる（サイト全体の「ブラウザに4時間キャッシュ」設定に巻き込まれないように）
function withBrowserHeaders(res) {
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'no-cache, private');
  return out;
}
