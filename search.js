// Vercel serverless function: proxies Tavily search so the API key stays on the server.
// Set TAVILY_API_KEY in Vercel -> Project -> Settings -> Environment Variables, then redeploy.
// Handles type=web and type=news (Tavily has no image/video search; the page uses other sources for those).
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const key = process.env.TAVILY_API_KEY;
  if (!key) return res.status(501).end(JSON.stringify({ error: 'TAVILY_API_KEY is not set' }));

  // Only allow requests made by your own pages (stops other sites using your key)
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).end(JSON.stringify({ error: 'forbidden' }));

  const q = String(req.query.q || '').trim();
  const type = req.query.type === 'news' ? 'news' : req.query.type === 'web' ? 'web' : null;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  if (!q || q.length > 400) return res.status(400).end(JSON.stringify({ error: 'bad query' }));
  if (!type) return res.status(400).end(JSON.stringify({ error: 'unsupported type' }));
  if (page > 1) return res.status(200).end(JSON.stringify({ items: [], hasMore: false })); // Tavily returns one page of up to 20

  const body = { query: q, max_results: 20, search_depth: 'basic', topic: type === 'news' ? 'news' : 'general', include_answer: false };
  if (type === 'news') body.days = 30;
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body)
    });
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).end(JSON.stringify({ error: 'upstream ' + r.status }));
    const d = await r.json();
    const items = (d.results || []).map((x) => {
      let host = '';
      try { host = new URL(x.url).hostname.replace(/^www\./, ''); } catch (e) {}
      return { title: x.title || '', url: x.url || '', snippet: String(x.content || '').replace(/\s+/g, ' ').slice(0, 300), domain: host, age: x.published_date || '', thumb: '', full: '', w: 0, h: 0 };
    });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).end(JSON.stringify({ items, hasMore: false }));
  } catch (e) {
    return res.status(502).end(JSON.stringify({ error: 'fetch failed' }));
  }
};
