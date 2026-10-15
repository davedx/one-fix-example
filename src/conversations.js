const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
export async function tokenHash(token) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2,'0')).join('');
}
export function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
}
export async function conversationAPI(request, env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  if (!/^[a-f0-9]{64}$/.test(token)) return json({error:'Invalid private link.'},404);
  const conversation = await env.DB.prepare('SELECT r.id,r.website,r.problem,r.status,r.source FROM conversations c JOIN requests r ON r.id=c.request_id WHERE c.token_hash=?').bind(await tokenHash(token)).first();
  if (!conversation) return json({error:'This private link is invalid or has expired.'},404);
  if (request.method === 'GET') {
    const messages = await env.DB.prepare('SELECT id,created_at,role,body FROM messages WHERE request_id=? ORDER BY created_at,id LIMIT 300').bind(conversation.id).all();
    return json({...conversation,messages:messages.results});
  }
  if (request.method !== 'POST') return json({error:'Use GET or POST.'},405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({error:'Invalid origin.'},403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({error:'JSON required.'},415);
  if (Number(request.headers.get('content-length')) > 12000) return json({error:'Message too large.'},413);
  const raw = await request.text();
  if (raw.length > 12000) return json({error:'Message too large.'},413);
  let data;
  try { data=JSON.parse(raw); } catch { return json({error:'Invalid message.'},400); }
  const body = typeof data?.body === 'string' ? data.body.trim() : '';
  if (!body || body.length > 6000 || !/^[a-f0-9-]{36}$/.test(data?.id || '')) return json({error:'Write a message of up to 6,000 characters.'},400);
  const count = await env.DB.prepare("SELECT count(*) AS n FROM messages WHERE request_id=? AND role='customer' AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')").bind(conversation.id).first();
  if (count.n >= 30) return json({error:'Message limit reached. Please try again in an hour.'},429);
  await env.DB.prepare("INSERT OR IGNORE INTO messages(id,request_id,role,body) VALUES (?,?,'customer',?)").bind(`${conversation.id}:${data.id}`,conversation.id,body).run();
  return json({ok:true},201);
}

export async function notifyCustomer(env, email, link, id, update = false) {
  if (env.EMAIL_DISABLED === 'true' || !env.RESEND_API_KEY || !env.EMAIL_FROM) return;
  const result=await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`onefix-conversation-${id}`},
    body:JSON.stringify({from:env.EMAIL_FROM,to:[email],subject:update?'One Fix: update in your private conversation':'One Fix: your private scope conversation',text:`${update?'There is an update to your request.':'Your free scope request is saved. No payment is due.'}\n\nRead and reply securely here:\n${link}\n\nKeep this private link safe: anyone with it can read and reply to your request. Add reproduction steps and code links there; do not send passwords or API keys. The AI coding agent handles scope and delivery in that conversation. Please use the website to reply; this email inbox is not monitored.\n\nOne Fix / Red Sky Forge\nAdamsdreef 5, 6716 ME Ede, Netherlands`}),signal:AbortSignal.timeout(10000)
  });
  if (!result.ok) throw new Error('Customer notification failed');
}
