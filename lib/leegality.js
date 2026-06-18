// Leegality eSign (optional). Enable by setting LEEGALITY_* env vars + turning on
// eSign in the super-admin Settings. Field names vary by Leegality plan/version —
// verify the pick_() paths against your API docs.
const store = require('./store');
const { buildSigned } = require('./pdf');

function base() { return (process.env.LEEGALITY_BASE || 'https://app.leegality.com').replace(/\/+$/, ''); }
function pick(obj, paths) {
  for (const p of paths) { let cur = obj, ok = true;
    for (const part of p.split('.')) { if (cur == null) { ok = false; break; } cur = cur[part]; }
    if (ok && cur != null && cur !== '') return cur;
  }
  return null;
}

async function start(portal, token, docName) {
  const c = await store.findByToken(token);
  const docDef = portal.documents.find(d => d.name === docName);
  const when = new Date();
  const pdf = await buildSigned(c, docDef, { type: 'esign', value: '' }, when, portal.company);
  const payload = {
    name: docName,
    file: pdf.toString('base64'),
    invitees: [{ name: c.name, email: c.email, signType: (portal.esign && portal.esign.signType) || 'AADHAAR' }],
    callbackUrl: (process.env.PUBLIC_URL || '') + '/api/leegality-webhook' +
      (process.env.LEEGALITY_WEBHOOK_SECRET ? '?secret=' + encodeURIComponent(process.env.LEEGALITY_WEBHOOK_SECRET) : '')
  };
  if (process.env.LEEGALITY_PROFILE_ID) payload.profileId = process.env.LEEGALITY_PROFILE_ID;
  const res = await fetch(base() + '/api/v3.0/sign/request', {
    method: 'POST', headers: { 'X-Auth-Token': process.env.LEEGALITY_AUTH_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const j = await res.json().catch(() => ({}));
  const documentId = pick(j, ['data.documentId', 'documentId', 'data.id', 'id']);
  const signUrl = pick(j, ['data.invitees.0.signUrl', 'data.signUrl', 'invitees.0.signUrl', 'data.url', 'signUrl']);
  if (!documentId || !signUrl) throw new Error('Leegality did not return a signing URL.');
  await store.upsertEsign(c.id, docName, documentId, 'pending', signUrl);
  await store.appendLog(c.id, 'Started Leegality eSign for ' + docName, c.email);
  return { signUrl };
}

// Called by the webhook function when Leegality reports a signed document.
async function onSigned(portal, documentId, signedUrl) {
  const map = await store.findEsignByDoc(documentId);
  if (!map) return false;
  let buf;
  if (signedUrl) {
    const r = await fetch(signedUrl, { headers: { 'X-Auth-Token': process.env.LEEGALITY_AUTH_TOKEN } });
    buf = Buffer.from(await r.arrayBuffer());
  } else {
    const r = await fetch(base() + '/api/v3.0/sign/' + documentId + '/file', { headers: { 'X-Auth-Token': process.env.LEEGALITY_AUTH_TOKEN } });
    buf = Buffer.from(await r.arrayBuffer());
  }
  const cand = await store.getCandidate(map.candidateId);
  const file = await store.savePdf(cand.name, map.document, buf);
  await store.addSigned(cand.id, map.document);
  await store.recordSignature(cand.id, map.document, cand.name, new Date().toISOString(), file.webViewLink || '');
  await store.upsertEsign(cand.id, map.document, documentId, 'signed', '');
  await store.appendLog(cand.id, 'Signed ' + map.document + ' via Leegality eSign', cand.email);
  try { const zoho = require('./zoho'); if (zoho.enabled(portal)) { await zoho.upload(portal, cand.name, map.document + ' — signed.pdf', buf); await store.appendLog(cand.id, 'Synced ' + map.document + ' to Zoho WorkDrive', ''); } } catch (z) {}
  return true;
}

module.exports = { start, onSigned, pick };
