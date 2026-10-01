// おすすめの曲：YouTube の再生リスト「えびはおすすめ曲」を読んで JSON で返す（Cloudflare Pages Functions）
// 再生リストに曲を足すと、最大10分でサイトに出る。YouTube の公開フィードを使うので APIキーは不要。
// 注意：フィードで取れるのは再生リストの先頭から15曲まで。
const PLAYLIST = 'PLbQ2zSt599Co';
const TTL = 600; // 秒。この間はキャッシュを返して YouTube に取りに行かない

const decode = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const pick = (xml, re) => { const m = xml.match(re); return m ? decode(m[1].trim()) : ''; };

export async function onRequest(context) {
  const cache = caches.default;
  const key = new Request(new URL(context.request.url).origin + `/api/songs?__cache=${PLAYLIST}`);
  const hit = await cache.match(key);
  if (hit) return withBrowserHeaders(hit);

  let songs = [];
  try {
    const r = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${PLAYLIST}`, { headers: { 'Accept-Language': 'ja' } });
    if (!r.ok) throw new Error('feed ' + r.status);
    const xml = await r.text();
    songs = (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).map(e => ({
      id: pick(e, /<yt:videoId>([^<]+)<\/yt:videoId>/),
      title: pick(e, /<title>([^<]*)<\/title>/),
      // YouTube Music の自動生成チャンネルは「アーティスト - Topic」なので Topic を外す
      artist: pick(e, /<author>\s*<name>([^<]*)<\/name>/).replace(/\s*-\s*Topic$/, ''),
    })).filter(s => /^[\w-]{11}$/.test(s.id));
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), songs: [] }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }

  const res = new Response(JSON.stringify({ playlist: PLAYLIST, songs }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${TTL}` },
  });
  context.waitUntil(cache.put(key, res.clone()));
  return withBrowserHeaders(res);
}

// ブラウザには毎回聞き直させる（サイト全体の「ブラウザに4時間キャッシュ」設定に巻き込まれないように）
function withBrowserHeaders(res) {
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'no-cache, private');
  return out;
}
