import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test('a mobile visitor can submit an issue and gets a durable reference', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?ref=automated-test');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Fixed.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Your email').fill('acceptance@example.com');
  await page.getByLabel('Website URL', { exact: true }).fill('https://example.com');
  await page.getByLabel('What is it built with?').selectOption('HTML / CSS / JavaScript');
  await page.getByLabel('What’s broken, and what should happen?').fill('The mobile navigation overlaps the call to action. It should fit at 390px.');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Check my issue' }).click();
  await expect(page.getByRole('status')).toContainText('Request received.');
  await expect(page.getByRole('status')).toContainText(/reference: [a-f0-9-]{36}/);
  await expect(page.getByRole('status')).toContainText('No payment is due.');
  const conversation = page.getByRole('link', {name:'Open your private conversation'});
  await expect(conversation).toHaveAttribute('href',/conversation#[a-f0-9]{64}$/);
  await conversation.click();
  await expect(page.locator('#reference')).toContainText('https://example.com');
  await page.getByLabel('Your message').fill('Here are the reproduction steps: open at 390px and tap menu. <script>alert(1)</script>');
  await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.getByRole('status')).toContainText('Message saved.');
  await page.reload();
  await expect(page.locator('#thread')).toContainText('Here are the reproduction steps');
  const token = new URL(page.url()).hash.slice(1);
  const auth = {authorization:`Bearer ${token}`};
  const record = await (await page.request.get('/api/conversation',{headers:auth})).json();
  expect(record.messages).toHaveLength(1);
  const duplicateId = crypto.randomUUID();
  const payload = {id:duplicateId,body:'Same request retry'};
  const postHeaders = {...auth,origin:'http://127.0.0.1:8787'};
  expect((await page.request.post('/api/conversation',{headers:auth,data:payload})).status()).toBe(403);
  await page.request.post('/api/conversation',{headers:postHeaders,data:payload});
  await page.request.post('/api/conversation',{headers:postHeaders,data:payload});
  const after = await (await page.request.get('/api/conversation',{headers:auth})).json();
  expect(after.messages).toHaveLength(2);
  execFileSync('npx',['wrangler','d1','execute','one-fix-example','--local','--command',`INSERT INTO messages(id,request_id,role,body,reviewed) VALUES ('${crypto.randomUUID()}','${record.id}','agent','Scope confirmed. Reply here before payment.',1)`]);
  await page.reload();
  await expect(page.locator('#thread')).toContainText('Scope confirmed. Reply here before payment.');
  expect(errors).toEqual([]);
});

test('API rejects malformed, cross-origin and oversized submissions', async ({ request }) => {
  const endpoint = '/api/request';
  expect((await request.post(endpoint, { data: {} })).status()).toBe(403);
  const headers = { origin: 'http://127.0.0.1:8787' };
  expect((await request.post(endpoint, { headers, data: {} })).status()).toBe(400);
  expect((await request.post(endpoint, { headers, data: { website: 'javascript:alert(1)' } })).status()).toBe(400);
  expect((await request.post(endpoint, { headers, data: { problem: 'x'.repeat(13000) } })).status()).toBe(413);
});

test('failure preserves input and permits retry; legal and missing pages work', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/request', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Please try again shortly.' }) }));
  await page.getByLabel('Your email').fill('retry@example.com');
  await page.getByLabel('Website URL', { exact: true }).fill('https://example.com');
  await page.getByLabel('What is it built with?').selectOption('React / Next.js');
  await page.getByLabel('What’s broken, and what should happen?').fill('The navigation toggle does not open on a mobile screen.');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Check my issue' }).click();
  await expect(page.getByRole('status')).toContainText('Please try again shortly.');
  await expect(page.getByLabel('Your email')).toHaveValue('retry@example.com');
  await expect(page.getByRole('button', { name: 'Check my issue' })).toBeEnabled();
  await page.goto('/privacy.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy notice');
  const missing = await page.goto('/does-not-exist');
  expect(missing.status()).toBe(404);
});

 test('private conversation rejects missing and incorrect keys',async ({request})=>{
  expect((await request.get('/api/conversation')).status()).toBe(404);
  expect((await request.get('/api/conversation',{headers:{authorization:'Bearer '+ 'a'.repeat(64)}})).status()).toBe(404);
 });
