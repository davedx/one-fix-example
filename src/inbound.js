import PostalMime from 'postal-mime';

const MAX_BYTES = 1024 * 1024;
const clean = (value, limit) => String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/conversation(?:\.html)?(?:#|%23|&#0*35;|&#x0*23;)[a-f0-9]{64}/gi, '[private conversation link omitted]').slice(0, limit);

async function boundedBytes(stream) {
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new Error('Message too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

// Email is an untrusted fallback queue, never an authorization or a paid order.
// It is not rendered in the website and never forwarded to the operator.
export async function receiveEmail(message, env) {
  if (message.to.toLowerCase() !== 'onefix@remontoire.ai') {
    message.setReject('Unknown recipient');
    return { rejected: true };
  }
  if (message.rawSize > MAX_BYTES) {
    message.setReject('Message exceeds 1 MiB. Please use remontoire.ai with a reproduction link.');
    return { rejected: true };
  }
  let bytes;
  try { bytes = await boundedBytes(message.raw); }
  catch {
    message.setReject('Could not read message within the 1 MiB limit. Please use remontoire.ai.');
    return { rejected: true };
  }
  const mail = await PostalMime.parse(bytes);
  const attachments = mail.attachments?.length || 0;
  const omitted = attachments ? `\n\n[${attachments} attachment(s) omitted; please supply a code/reproduction link.]` : '';
  const body = clean(mail.text || (mail.html ? `[HTML-only email source; untrusted]\n${mail.html}` : '[No text body]'), 32000) + omitted;
  const fields = [
    clean(mail.from?.address || message.from, 254).toLowerCase(),
    clean(message.from, 254).toLowerCase(),
    message.to.toLowerCase(),
    clean(mail.replyTo?.[0]?.address || mail.from?.address || message.from, 254).toLowerCase(),
    clean(mail.subject, 500),
    clean(mail.messageId, 1000),
    clean(mail.inReplyTo, 1000),
    clean(mail.references, 4000),
    body,
    attachments,
  ];
  // A retransmission is deduplicated by the content we actually retain, not by
  // untrusted Message-ID alone or transport headers that change during retries.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fields)));
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare(`INSERT OR IGNORE INTO inbox
    (id,from_address,envelope_from,to_address,reply_to,subject,message_id,in_reply_to,references_header,text_body,attachment_count,authentication)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, ...fields, clean(message.headers.get('authentication-results'), 4000)).run();
  return { stored: true, id };
}
