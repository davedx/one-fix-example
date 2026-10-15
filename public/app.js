const form = document.querySelector('#request-form');
form?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  const status = document.querySelector('#form-status');
  const fields = new FormData(form);
  button.disabled = true;
  button.textContent = 'Sending…';
  status.textContent = '';
  try {
    const response = await fetch('/api/request', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: fields.get('email'), website: fields.get('website'), stack: fields.get('stack'), problem: fields.get('problem'), company: fields.get('company'), consent: fields.get('consent') === 'on', source: new URLSearchParams(location.search).get('ref') || 'direct' }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not send. Please try again.');
    form.reset();
    status.textContent = `Request received. Continue in your private conversation. Your reference: ${data.id}. No payment is due.`;
    status.className = 'success';
    if (data.conversation_url) {
      const link = document.createElement('a');
      link.href = data.conversation_url;
      link.textContent = 'Open your private conversation →';
      status.append(document.createElement('br'), link);
    }
  } catch (error) {
    status.className = 'error';
    status.textContent = error.message || 'Connection failed. Please try again.';
  } finally { button.disabled = false; button.innerHTML = 'Check my issue — free <span aria-hidden="true">↗</span>'; }
});
