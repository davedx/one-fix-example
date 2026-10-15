import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {receiveEmail} from '../src/inbound.js';
import worker from '../src/worker.js';

function setup(t) {
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 for(const file of ['schema.sql','conversation-schema.sql','inbox-schema.sql'])db.exec(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
 t.after(()=>db.close());
 return {db,env:{DB:{prepare(sql){const statement=db.prepare(sql);return {async run(){return statement.run();},bind(...values){return {async run(){return statement.run(...values);}};}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}}}};
}
function message(body,{to='onefix@remontoire.ai',size}={}) {
 const bytes=new TextEncoder().encode(body);
 return {from:'bounce@example.com',to,rawSize:size??bytes.length,headers:new Headers({'authentication-results':'example.invalid; dmarc=pass'}),raw:new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),setReject(reason){this.rejection=reason;},forward(){throw Error('Must not forward to operator');},reply(){throw Error('Must not send automatic replies');}};
}
const plain=body=>`From: Prospect <prospect@example.com>\r\nTo: onefix@remontoire.ai\r\nSubject: A frontend repair\r\nMessage-ID: <same-id@example.com>\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`;

test('MIME decoding stores a private text inquiry and omits attachment bytes',async t=>{
 const {db,env}=setup(t);
 const raw='From: Prospect <prospect@example.com>\r\nReply-To: reply@example.com\r\nTo: onefix@remontoire.ai\r\nSubject: =?UTF-8?B?TW9iaWxlIHJlcGFpcg==?=\r\nMessage-ID: <multipart@example.com>\r\nIn-Reply-To: <quote@example.com>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="fixture"\r\n\r\n--fixture\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from('Please fix our mobile menu.').toString('base64')+'\r\n--fixture\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="private.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\ncHJpdmF0ZSBhdHRhY2htZW50\r\n--fixture--';
 const result=await receiveEmail(message(raw),env);
 assert.equal(result.stored,true);
 const row=db.prepare('SELECT * FROM inbox').get();
 assert.equal(row.from_address,'prospect@example.com');assert.equal(row.reply_to,'reply@example.com');
 assert.equal(row.envelope_from,'bounce@example.com');assert.equal(row.subject,'Mobile repair');
 assert.equal(row.in_reply_to,'<quote@example.com>');assert.match(row.text_body,/Please fix our mobile menu/);
 assert.equal(row.attachment_count,1);assert.doesNotMatch(row.text_body,/private attachment/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inbox_attachments').get().n,0);
});

test('duplicate delivery is one row, changed content with same Message-ID is retained',async t=>{
 const {db,env}=setup(t);
 await receiveEmail(message(plain('First scope')),env);
 await receiveEmail(message(plain('First scope')),env);
 await receiveEmail(message(plain('Corrected scope')),env);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inbox').get().n,2);
});

test('another recipient is rejected before ingestion',async t=>{
 const {db,env}=setup(t),mail=message(plain('Should not store'),{to:'other@example.com'});
 assert.equal((await receiveEmail(mail,env)).rejected,true);assert.match(mail.rejection,/Unknown recipient/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inbox').get().n,0);
});

test('size enforcement checks both declared length and actual streamed bytes',async t=>{
 const {db,env}=setup(t);
 for(const mail of [message(plain('small'),{size:1048577}),message('x'.repeat(1048577),{size:0})]) {
  assert.equal((await receiveEmail(mail,env)).rejected,true);assert.ok(mail.rejection);
 }
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inbox').get().n,0);
});

test('HTML-only mail stays labelled inert source in the private queue',async t=>{
 const {db,env}=setup(t);
 const mail=message('From: p@example.com\r\nSubject: HTML-only\r\nContent-Type: text/html\r\n\r\n<p>Menu broken</p><script>not executed</script>');
 await receiveEmail(mail,env);
 assert.match(db.prepare('SELECT text_body FROM inbox').get().text_body,/^\[HTML-only email source; untrusted\]/);
});


test('quoted private conversation keys are omitted from stored email bodies',async t=>{
 const {db,env}=setup(t),key='a'.repeat(64);
 await receiveEmail(message(plain('Reply above original https://remontoire.ai/conversation#'+key)),env);
 const body=db.prepare('SELECT text_body FROM inbox').get().text_body;
 assert.doesNotMatch(body,new RegExp(key));assert.match(body,/private conversation link omitted/);
});


test('scheduled retention removes old email and child rows while retaining fresh email',async t=>{
 const {db,env}=setup(t);
 const old=await receiveEmail(message(plain('Old email')),env);
 const fresh=await receiveEmail(message(plain('Fresh email')),env);
 db.prepare("UPDATE inbox SET received_at='2020-01-01T00:00:00Z' WHERE id=?").run(old.id);
 db.prepare("INSERT INTO inbox_attachments(id,inbox_id,filename,content_type,content) VALUES ('old-attachment',?,'old.txt','text/plain',X'01')").run(old.id);
 await worker.scheduled({},env);
 assert.equal(db.prepare('SELECT id FROM inbox WHERE id=?').get(old.id),undefined);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inbox_attachments').get().n,0);
 assert.equal(db.prepare('SELECT id FROM inbox').get().id,fresh.id);
});
