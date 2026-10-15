import { conversationAPI, newToken, tokenHash, notifyCustomer } from './conversations.js';

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

export default {
  async scheduled(_controller, env) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM messages WHERE request_id IN (SELECT id FROM requests WHERE status IN ('new','invited','reviewing','accepted','declined') AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days'))"),
      env.DB.prepare("DELETE FROM conversations WHERE request_id IN (SELECT id FROM requests WHERE status IN ('new','invited','reviewing','accepted','declined') AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days'))"),
      env.DB.prepare("DELETE FROM requests WHERE status IN ('new','invited','reviewing','accepted','declined') AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')"),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Date.now()),
      env.DB.prepare("DELETE FROM events WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')"),
    ]);
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === 'www.remontoire.ai') {
      return Response.redirect(`https://remontoire.ai${url.pathname}${url.search}`, 308);
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true });
    if (url.pathname === '/api/conversation') {
      try { return await conversationAPI(request, env); } catch { return json({error:'Conversation temporarily unavailable. Please retry.'},503); }
    }
    if (url.pathname !== '/api/request') return json({ error: 'Not found' }, 404);
    if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
    if (request.headers.get('origin') !== url.origin) return json({ error: 'Invalid origin' }, 403);
    if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'JSON required' }, 415);
    if (Number(request.headers.get('content-length')) > 12000) return json({ error: 'Request too large' }, 413);
    let data;
    try {
      const body = await request.text();
      if (body.length > 12000) return json({ error: 'Request too large' }, 413);
      data = JSON.parse(body);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    } catch { return json({ error: 'Invalid request' }, 400); }
    if (data.company) return json({ ok: true, id: 'received' });
    const clean = (key, max) => typeof data[key] === 'string' ? data[key].trim().slice(0, max) : '';
    const email = clean('email', 254), website = clean('website', 2000), problem = clean('problem', 4000), stack = clean('stack', 150), source = clean('source', 100) || 'direct';
    let site;
    try { site = new URL(website); } catch { return json({ error: 'Enter a full website URL, starting with https://' }, 400); }
    if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password) return json({ error: 'Enter a public website URL without login details' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || problem.length < 20 || !stack || data.consent !== true) return json({ error: 'Please complete all fields and accept the privacy notice. Describe the issue in at least 20 characters.' }, 400);
    const hour = Math.floor(Date.now() / 3600000);
    const input = new TextEncoder().encode(`${request.headers.get('cf-connecting-ip') || 'local'}:${hour}`);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), b => b.toString(16).padStart(2, '0')).join('');
    try {
      const limit = await env.DB.prepare('INSERT INTO rate_limits (fingerprint, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(fingerprint) DO UPDATE SET count=count+1 RETURNING count').bind(hash, (hour + 2) * 3600000).first();
      if (limit.count > 5) return json({ error: 'Too many requests. Please try again in an hour.' }, 429);
      const id = crypto.randomUUID();
      const token = newToken();
      const digest = await tokenHash(token);
      const conversation_url = `/conversation#${token}`;
      await env.DB.batch([
        env.DB.prepare('INSERT INTO requests (id,email,website,problem,stack,source) VALUES (?,?,?,?,?,?)').bind(id,email,website,problem,stack,source),
        env.DB.prepare('INSERT INTO conversations(request_id,token_hash) VALUES (?,?)').bind(id,digest),
        env.DB.prepare('INSERT INTO events (name,source) VALUES (?,?)').bind('request_submitted',source),
        env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Date.now()),
      ]);
      ctx.waitUntil(notifyCustomer(env,email,`https://remontoire.ai${conversation_url}`,id).catch(async () => {
        await env.DB.prepare('INSERT INTO events(name,source) VALUES (?,?)').bind('customer_notification_failed',id).run();
      }));
      return json({ ok: true, id, conversation_url }, 201);
    } catch { return json({ error: 'We could not save your request. Please try again shortly.' }, 503); }
  }
};
