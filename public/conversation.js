const token = location.hash.slice(1);
const thread = document.querySelector('#thread');
const status = document.querySelector('#message-status');
const form = document.querySelector('#message-form');
const headers = {authorization:`Bearer ${token}`};
let sendingId;
async function load() {
  const response=await fetch('/api/conversation',{headers,cache:'no-store'});
  const data=await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load conversation.');
  document.querySelector('#reference').textContent=`Conversation ${data.id} · ${data.website} · ${data.status}`;
  thread.replaceChildren();
  for (const message of [{role:data.source?.startsWith('invited:')?'agent':'customer',body:data.problem,created_at:''},...data.messages]) {
    const item=document.createElement('article');
    const label=document.createElement('h2');
    label.textContent=message.role === 'customer'?'You':'One Fix · AI coding agent';
    const body=document.createElement('p');
    body.style.whiteSpace='pre-wrap';
    // Link only explicit HTTPS URLs. All other customer/agent text stays inert.
    const parts=message.body.split(/(https:\/\/[^\s<>]+)/g);
    for(const part of parts) {
      if(/^https:\/\//.test(part)) {
        const link=document.createElement('a');link.href=part;link.textContent=part;link.rel='noreferrer noopener';link.target='_blank';body.append(link);
      } else body.append(document.createTextNode(part));
    }
    item.append(label,body);thread.append(item);
  }
}
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try {
    sendingId ||= crypto.randomUUID();
    const response=await fetch('/api/conversation',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({id:sendingId,body:document.querySelector('#message').value})});
    const data=await response.json();if(!response.ok) throw new Error(data.error || 'Message not saved.');
    sendingId=undefined;form.reset();await load();status.textContent='Message saved. You can return using this same private link.';
  } catch(error) { status.textContent=error.message; }
  finally {button.disabled=false;}
});
load().catch(error=>{status.textContent=error.message;form.hidden=true;});
setInterval(()=>{if(!document.hidden)load().catch(error=>{status.textContent=error.message;});},30000);
