// ═══════════════════════════════════════════════════════
//  Eve Cinema — Cloudflare Worker (Single File)
//  Routes:
//    GET /api/stream?tmdb=ID&type=movie|tv&season=1&episode=1
//    GET /api/subtitles?tmdb=ID&type=movie|tv&season=1&episode=1
// ═══════════════════════════════════════════════════════

// ── API Keys ──────────────────────────────────────────────
const OPENSUBTITLES_KEY = 'cAp7jaOhDMqxt6RSY4zOkCfcbR85AJ81';
const SUBDL_KEY         = 'A1XhC_wAyIY513OsWyccukDdx77TthU0';
const APP_USER_AGENT    = 'EveStreamApp v1.0';

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Helper ────────────────────────────────────────────────
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra },
  });
}

// ════════════════════════════════════════════════════════
//  STREAM SOURCES
// ════════════════════════════════════════════════════════

async function tryAutoEmbed(tmdb, type, season, episode) {
  try {
    const url = type === 'tv'
      ? `https://tom.autoembed.cc/api/getVideoSource?type=tv&id=${tmdb}&season=${season}&episode=${episode}`
      : `https://tom.autoembed.cc/api/getVideoSource?type=movie&id=${tmdb}`;

    const res = await fetch(url, {
      headers: { ...BASE_HEADERS, 'Referer': 'https://player.autoembed.cc/', 'Origin': 'https://player.autoembed.cc' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    let videoUrl = data?.videoSource || data?.url || data?.stream || data?.link;
    if (!videoUrl && Array.isArray(data) && data.length > 0) videoUrl = data[0]?.file || data[0]?.url;
    if (videoUrl && (videoUrl.includes('.m3u8') || videoUrl.includes('.mp4')))
      return { url: videoUrl, source: 'autoembed', quality: 'auto', priority: 1 };

    if (data?.sources?.length > 0)
      return { url: data.sources[0].file || data.sources[0].url, source: 'autoembed', quality: data.sources[0].label || 'auto', priority: 1 };

    return null;
  } catch { return null; }
}

async function tryVidLink(tmdb, type, season, episode) {
  try {
    const url = type === 'tv'
      ? `https://vidlink.pro/api/b/tv?id=${tmdb}&season=${season}&episode=${episode}&multiLang=0`
      : `https://vidlink.pro/api/b/movie?id=${tmdb}&multiLang=0`;

    const res = await fetch(url, {
      headers: { ...BASE_HEADERS, 'Referer': 'https://vidlink.pro/', 'Origin': 'https://vidlink.pro' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    const playlist = data?.stream?.playlist || data?.playlist || data?.url;
    if (!playlist) return null;

    const result = { url: playlist, source: 'vidlink', quality: 'auto', priority: 2 };
    const arSub = data?.stream?.captions?.find(c =>
      c.language?.toLowerCase().includes('arab') || c.language === 'ar'
    );
    if (arSub) result.subtitle = arSub.url;
    return result;
  } catch { return null; }
}

async function try2Embed(tmdb, type, season, episode) {
  try {
    const url = type === 'tv'
      ? `https://www.2embed.cc/embedtv/${tmdb}&s=${season}&e=${episode}`
      : `https://www.2embed.cc/embed/${tmdb}`;

    const res = await fetch(url, {
      headers: { ...BASE_HEADERS, 'Referer': 'https://www.2embed.cc/' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();

    const m3u8 = html.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/);
    if (m3u8) return { url: m3u8[0], source: '2embed', quality: 'auto', priority: 3 };

    const file = html.match(/"file"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
    if (file) return { url: file[1].replace(/\\/g, ''), source: '2embed', quality: 'auto', priority: 3 };

    return null;
  } catch { return null; }
}

async function tryMultiEmbed(tmdb, type, season, episode) {
  try {
    const url = type === 'tv'
      ? `https://multiembed.mov/directstream.php?video_id=${tmdb}&tmdb=1&s=${season}&e=${episode}`
      : `https://multiembed.mov/directstream.php?video_id=${tmdb}&tmdb=1`;

    const res = await fetch(url, { headers: BASE_HEADERS, signal: AbortSignal.timeout(8000), redirect: 'follow' });
    const finalUrl = res.url;
    if (finalUrl.includes('.m3u8') || finalUrl.includes('.mp4'))
      return { url: finalUrl, source: 'multiembed', quality: 'auto', priority: 4 };

    if (!res.ok) return null;
    const m3u8 = (await res.text()).match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
    if (m3u8) return { url: m3u8[0], source: 'multiembed', quality: 'auto', priority: 4 };

    return null;
  } catch { return null; }
}

async function tryAnimeAutoEmbed(anilistId, episode) {
  try {
    const res = await fetch(
      `https://tom.autoembed.cc/api/getVideoSource?type=anime&id=${anilistId}&episode=${episode}`,
      { headers: { ...BASE_HEADERS, 'Referer': 'https://player.autoembed.cc/', 'Origin': 'https://player.autoembed.cc' }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.videoSource || data?.url;
    return videoUrl ? { url: videoUrl, source: 'autoembed-anime', quality: 'auto', priority: 1 } : null;
  } catch { return null; }
}

// ════════════════════════════════════════════════════════
//  SUBTITLE SOURCES
// ════════════════════════════════════════════════════════

async function getOpenSubtitles(tmdb, type, season, episode) {
  try {
    const params = new URLSearchParams({ tmdb_id: tmdb, languages: 'ar', type: type === 'tv' ? 'episode' : 'movie' });
    if (type === 'tv') { params.append('season_number', season); params.append('episode_number', episode); }

    const searchRes = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?${params}`, {
      headers: { 'Api-Key': OPENSUBTITLES_KEY, 'Content-Type': 'application/json', 'User-Agent': APP_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    if (!searchData.data?.length) return null;

    const subtitle = searchData.data
      .filter(s => s.attributes?.language === 'ar')
      .sort((a, b) => (b.attributes?.ratings || 0) - (a.attributes?.ratings || 0))[0];
    if (!subtitle) return null;

    const fileId = subtitle.attributes?.files?.[0]?.file_id;
    if (!fileId) return null;

    const dlRes = await fetch('https://api.opensubtitles.com/api/v1/download', {
      method: 'POST',
      headers: { 'Api-Key': OPENSUBTITLES_KEY, 'Content-Type': 'application/json', 'User-Agent': APP_USER_AGENT },
      body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!dlRes.ok) return null;
    const dlData = await dlRes.json();
    if (!dlData.link) return null;

    return { url: dlData.link, language: 'ar', source: 'opensubtitles', format: 'srt', rating: subtitle.attributes?.ratings || 0, title: subtitle.attributes?.release || '' };
  } catch { return null; }
}

async function getSubDL(tmdb, type, season, episode) {
  try {
    const params = new URLSearchParams({ api_key: SUBDL_KEY, tmdb_id: tmdb, lang: 'AR', type: type === 'tv' ? 'tv' : 'movie', subs_per_page: '5' });
    if (type === 'tv') { params.append('season_number', season); params.append('episode_number', episode); }

    const res = await fetch(`https://api.subdl.com/api/v1/subtitles/search?${params}`, {
      headers: { 'Content-Type': 'application/json', 'User-Agent': APP_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.status || !data.subtitles?.length) return null;

    const sub = data.subtitles[0];
    const downloadUrl = sub.url ? `https://dl.subdl.com${sub.url}` : null;
    if (!downloadUrl) return null;

    return { url: downloadUrl, language: 'ar', source: 'subdl', format: 'zip', rating: sub.rating || 0, title: sub.release_name || '' };
  } catch { return null; }
}

// ════════════════════════════════════════════════════════
//  MAIN ROUTER
// ════════════════════════════════════════════════════════

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });

    const url = new URL(request.url);
    const p   = url.searchParams;

    // ── /api/stream ───────────────────────────────────────
    if (url.pathname === '/api/stream') {
      const tmdb    = p.get('tmdb');
      const type    = p.get('type') || 'movie';
      const season  = p.get('season') || '1';
      const episode = p.get('episode') || '1';
      const anilist = p.get('anilist');

      if (!tmdb && !anilist)
        return json({ success: false, error: 'Missing tmdb or anilist parameter' }, 400);

      const jobs = anilist
        ? [tryAnimeAutoEmbed(anilist, episode), tmdb ? tryAutoEmbed(tmdb, 'tv', season, episode) : Promise.resolve(null)]
        : [tryAutoEmbed(tmdb, type, season, episode), tryVidLink(tmdb, type, season, episode), try2Embed(tmdb, type, season, episode), tryMultiEmbed(tmdb, type, season, episode)];

      const streams = (await Promise.allSettled(jobs))
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value)
        .sort((a, b) => a.priority - b.priority);

      if (!streams.length)
        return json({ success: false, error: 'No streams found', tmdb: tmdb || null, type }, 404);

      return json({ success: true, primary: streams[0], streams, count: streams.length });
    }

    // ── /api/subtitles ────────────────────────────────────
    if (url.pathname === '/api/subtitles') {
      const tmdb    = p.get('tmdb');
      const type    = p.get('type') || 'movie';
      const season  = p.get('season') || '1';
      const episode = p.get('episode') || '1';

      if (!tmdb) return json({ success: false, error: 'Missing tmdb parameter' }, 400);

      const [osR, sdR] = await Promise.allSettled([
        getOpenSubtitles(tmdb, type, season, episode),
        getSubDL(tmdb, type, season, episode),
      ]);

      const subtitles = [osR, sdR]
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0));

      if (!subtitles.length)
        return json({ success: false, error: 'No Arabic subtitles found' }, 404);

      return json({ success: true, primary: subtitles[0], subtitles }, 200, { 'Cache-Control': 'max-age=3600' });
    }

    return json({ error: 'Not Found' }, 404);
  },
};
