// Zoho WorkDrive sync (optional). Mirrors signed PDFs + KYC files into a per-candidate
// WorkDrive folder, alongside Google Drive. Secrets in env; dc + parent folder + on/off
// in the super-admin Settings (portal.zoho).
//
// Env: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
// Portal: zoho.enabled, zoho.dc ('com'|'in'|'eu'|'au'), zoho.parentFolderId

let _tok = { value: '', exp: 0 };

function dc(portal) { return (portal.zoho && portal.zoho.dc) || process.env.ZOHO_DC || 'com'; }
function apiBase(portal) { return 'https://www.zohoapis.' + dc(portal); }
function acctBase(portal) { return 'https://accounts.zoho.' + dc(portal); }
function parentId(portal) { return (portal.zoho && portal.zoho.parentFolderId) || process.env.ZOHO_PARENT_FOLDER_ID || ''; }

async function token(portal) {
  if (_tok.value && Date.now() < _tok.exp) return _tok.value;
  const body = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });
  const r = await fetch(acctBase(portal) + '/oauth/v2/token', { method: 'POST', body });
  const j = await r.json();
  if (!j.access_token) throw new Error('Zoho auth failed: ' + JSON.stringify(j));
  _tok = { value: j.access_token, exp: Date.now() + 50 * 60 * 1000 };
  return _tok.value;
}
function hdr(t) { return { Authorization: 'Zoho-oauthtoken ' + t }; }

async function findChildFolder(portal, t, pid, name) {
  const r = await fetch(apiBase(portal) + '/workdrive/api/v1/files/' + pid + '/files', { headers: hdr(t) });
  if (!r.ok) return null;
  const data = (await r.json()).data || [];
  const hit = data.find(d => { const a = d.attributes || {}; return a.name === name && (a.is_folder || a.type === 'folder'); });
  return hit ? hit.id : null;
}
async function candidateFolder(portal, t, name) {
  const pid = parentId(portal);
  const existing = await findChildFolder(portal, t, pid, name);
  if (existing) return existing;
  const r = await fetch(apiBase(portal) + '/workdrive/api/v1/files', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr(t)),
    body: JSON.stringify({ data: { attributes: { name, parent_id: pid }, type: 'files' } })
  });
  const j = await r.json();
  if (!j.data || !j.data.id) throw new Error('Zoho folder create failed: ' + JSON.stringify(j));
  return j.data.id;
}

/** Upload a file buffer into the candidate's Zoho WorkDrive folder. */
async function upload(portal, candidateName, filename, buffer) {
  const t = await token(portal);
  const folderId = await candidateFolder(portal, t, candidateName);
  const form = new FormData();
  form.append('parent_id', folderId);
  form.append('filename', filename);
  form.append('content', new Blob([buffer]), filename);
  const r = await fetch(apiBase(portal) + '/workdrive/api/v1/upload', { method: 'POST', headers: hdr(t), body: form });
  if (!r.ok) throw new Error('Zoho upload failed: ' + (await r.text()));
  return true;
}

function enabled(portal) {
  return !!(portal.zoho && portal.zoho.enabled && process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_CLIENT_ID);
}

module.exports = { upload, enabled };
