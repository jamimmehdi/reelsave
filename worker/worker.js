// Reelsave backend: Cloudflare Worker.
// GET /api/health
// GET /api/info?url=<instagram|facebook reel link>   -> { ok, videoUrl, thumbnail, title, author, source }
// GET /api/dl?u=<media url>&n=<filename>              -> streams the video with CORS + attachment headers

const UA_FB = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uagent.php)';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const PAGE_HOSTS = /(^|\.)(instagram\.com|instagr\.am|facebook\.com|fb\.watch|fb\.com)$/i;
const MEDIA_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net|instagram\.com|facebook\.com)$/i;

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ ok: true }, 200, cors);
      if (url.pathname === '/api/info') return await handleInfo(url, cors);
      if (url.pathname === '/api/dl') return await handleDownload(request, url, cors);
      return json({ ok: false, error: 'Not found' }, 404, cors);
    } catch (e) {
      return json({ ok: false, error: 'Something went wrong. Try again.' }, 500, cors);
    }
  },
};

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handleInfo(url, cors) {
  const target = url.searchParams.get('url') || '';
  let u;
  try { u = new URL(target); } catch { return json({ ok: false, error: 'That doesn’t look like a link.' }, 400, cors); }
  if (!/^https?:$/.test(u.protocol) || !PAGE_HOSTS.test(u.hostname)) {
    return json({ ok: false, error: 'Only Instagram and Facebook links are supported.' }, 400, cors);
  }

  const isIg = /(^|\.)(instagram\.com|instagr\.am)$/i.test(u.hostname);
  const result = isIg ? await resolveInstagram(u) : await resolveFacebook(u);
  if (!result || !result.videoUrl) {
    return json({
      ok: false,
      error: 'Couldn’t find a video. It may be private, age-restricted, or not a video.',
    }, 404, cors);
  }
  return json({ ok: true, source: isIg ? 'instagram' : 'facebook', ...result }, 200, cors);
}

async function handleDownload(request, url, cors) {
  const target = url.searchParams.get('u') || '';
  let m;
  try { m = new URL(target); } catch { return json({ ok: false, error: 'Bad media link' }, 400, cors); }
  if (m.protocol !== 'https:' || !MEDIA_HOSTS.test(m.hostname)) {
    return json({ ok: false, error: 'Host not allowed' }, 400, cors);
  }
  const name = (url.searchParams.get('n') || 'reel').replace(/[^\w\- ]+/g, '').slice(0, 60) || 'reel';

  const headers = { 'User-Agent': UA_MOBILE };
  const range = request.headers.get('Range');
  if (range) headers.Range = range;

  const up = await fetch(m.href, { headers });
  if (!up.ok && up.status !== 206) return json({ ok: false, error: 'Source refused the download' }, 502, cors);

  const out = new Headers(cors);
  out.set('Content-Type', up.headers.get('content-type') || 'video/mp4');
  const len = up.headers.get('content-length');
  if (len) out.set('Content-Length', len);
  if (up.headers.get('content-range')) out.set('Content-Range', up.headers.get('content-range'));
  out.set('Accept-Ranges', 'bytes');
  out.set('Content-Disposition', `attachment; filename="${name}.mp4"`);
  out.set('Cache-Control', 'no-store');
  return new Response(up.body, { status: up.status, headers: out });
}

// ---------- resolvers ----------

async function resolveInstagram(u) {
  const m = u.pathname.match(/\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/);
  const code = m && m[1];
  if (!code) return null;

  // 1) embed page usually exposes video_url in its JSON
  const embed = await getText(`https://www.instagram.com/p/${code}/embed/captioned/`, UA_DESKTOP);
  if (embed) {
    const video = findKey(embed, 'video_url');
    if (video) {
      return {
        videoUrl: video,
        thumbnail: findKey(embed, 'display_url') || findKey(embed, 'thumbnail_src') || meta(embed, 'og:image') || '',
        title: cleanTitle(findKey(embed, 'caption') || meta(embed, 'og:title')) || 'Instagram reel',
        author: findKey(embed, 'username') || '',
      };
    }
  }

  // 2) share-bot view of the page exposes og:video
  const page = await getText(`https://www.instagram.com/reel/${code}/`, UA_FB);
  if (page) {
    const video = meta(page, 'og:video:secure_url') || meta(page, 'og:video') || meta(page, 'og:video:url');
    if (video) {
      return {
        videoUrl: video,
        thumbnail: meta(page, 'og:image') || '',
        title: cleanTitle(meta(page, 'og:title')) || 'Instagram reel',
        author: '',
      };
    }
  }
  return null;
}

async function resolveFacebook(u) {
  // 1) share-bot view
  const bot = await getText(u.href, UA_FB);
  if (bot) {
    const video = meta(bot, 'og:video:secure_url') || meta(bot, 'og:video') || meta(bot, 'og:video:url');
    if (video) {
      return {
        videoUrl: video,
        thumbnail: meta(bot, 'og:image') || '',
        title: cleanTitle(meta(bot, 'og:title') || meta(bot, 'og:description')) || 'Facebook video',
        author: '',
      };
    }
  }

  // 2) regular page, look for playable urls in embedded JSON
  const page = await getText(u.href, UA_MOBILE);
  if (page) {
    const video =
      findKey(page, 'browser_native_hd_url') || findKey(page, 'playable_url_quality_hd') ||
      findKey(page, 'browser_native_sd_url') || findKey(page, 'playable_url') || findKey(page, 'hd_src') || findKey(page, 'sd_src');
    if (video) {
      return {
        videoUrl: video,
        thumbnail: meta(page, 'og:image') || '',
        title: cleanTitle(meta(page, 'og:title')) || 'Facebook video',
        author: '',
      };
    }
  }
  return null;
}

// ---------- parsing helpers ----------

async function getText(href, ua) {
  try {
    const r = await fetch(href, {
      headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#064;/g, '@');
}

function meta(html, prop) {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*?content=["']([^"']*)["']`, 'i').exec(html);
  if (a) return decodeEntities(a[1]);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${esc}["']`, 'i').exec(html);
  return b ? decodeEntities(b[1]) : '';
}

function unescapeJson(s) {
  return s
    .replace(/\\+u0026/gi, '&').replace(/\\+u0025/gi, '%').replace(/\\+u003d/gi, '=')
    .replace(/\\+\//g, '/').replace(/\\+"/g, '"').replace(/\\+n/g, ' ')
    .replace(/\\+u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function findKey(html, key) {
  const plain = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(html);
  if (plain && plain[1]) return unescapeJson(plain[1]);
  const escaped = new RegExp(`\\\\"${key}\\\\":\\\\"(.*?)\\\\"`).exec(html);
  if (escaped && escaped[1]) return unescapeJson(escaped[1]);
  return '';
}

function cleanTitle(t) {
  if (!t) return '';
  return t.replace(/\s+/g, ' ').trim().slice(0, 90);
}
