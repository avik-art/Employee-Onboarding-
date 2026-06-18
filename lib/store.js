// Google integration: auth (service account), Sheets DB, Drive storage, Gmail send.
const { google } = require('googleapis');
const { defaultPortal } = require('./config');

const SHEET_ID = process.env.SHEET_ID;
const PARENT_FOLDER_ID = process.env.PARENT_FOLDER_ID;
const GMAIL_SENDER = process.env.GMAIL_SENDER || ''; // mailbox to send as (needs domain-wide delegation)

function creds() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set.');
  return JSON.parse(raw);
}
let _jwtCache = {};
function jwt(scopes, subject) {
  const key = scopes.join(',') + '|' + (subject || '');
  if (_jwtCache[key]) return _jwtCache[key];
  const c = creds();
  const client = new google.auth.JWT({ email: c.client_email, key: c.private_key.replace(/\\n/g, '\n'), scopes, subject: subject || undefined });
  _jwtCache[key] = client;
  return client;
}
let _sheets, _drive;
function sheetsApi() { if (!_sheets) _sheets = google.sheets({ version: 'v4', auth: jwt(['https://www.googleapis.com/auth/spreadsheets']) }); return _sheets; }
function driveApi() { if (!_drive) _drive = google.drive({ version: 'v3', auth: jwt(['https://www.googleapis.com/auth/drive']) }); return _drive; }

/* ---------- Sheets helpers ---------- */
async function getRows(tab) {
  const api = sheetsApi();
  try {
    const r = await api.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: tab + '!A1:Z100000' });
    return r.data.values || [];
  } catch (e) { return []; } // tab may not exist yet (before setup)
}
async function appendRow(tab, arr) {
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: tab + '!A1', valueInputOption: 'RAW',
    requestBody: { values: [arr] }
  });
}
async function updateRow(tab, rowIndex1, arr) { // rowIndex1 is 1-based sheet row
  await sheetsApi().spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: tab + '!A' + rowIndex1 + ':Z' + rowIndex1,
    valueInputOption: 'RAW', requestBody: { values: [arr] }
  });
}

/* ---------- Candidates ---------- */
function parseArr(v) { try { return v ? JSON.parse(v) : []; } catch (e) { return []; } }
function rowToCand(r) {
  return { id: r[0], name: r[1], email: r[2], role: r[3], joining: r[4], status: r[5],
    token: r[6], created: r[7], expires: r[8], signed: parseArr(r[9]), agreed: parseArr(r[10]) };
}
async function allCandidates() {
  const data = await getRows('Candidates'); const out = [];
  for (let i = 1; i < data.length; i++) if (data[i][0]) out.push(rowToCand(data[i]));
  return out;
}
async function candidateRowIndex(id) {
  const data = await getRows('Candidates');
  for (let i = 1; i < data.length; i++) if (data[i][0] === id) return i + 1;
  return -1;
}
async function getCandidate(id) {
  const data = await getRows('Candidates');
  for (let i = 1; i < data.length; i++) if (data[i][0] === id) return rowToCand(data[i]);
  return null;
}
async function findByToken(token) {
  const all = await allCandidates();
  return all.find(c => c.token === token) || null;
}
async function insertCandidate(c) {
  await appendRow('Candidates', [c.id, c.name, c.email, c.role, c.joining, c.status, c.token,
    c.created, c.expires, JSON.stringify(c.signed || []), JSON.stringify(c.agreed || [])]);
}
async function setStatus(id, status) {
  const data = await getRows('Candidates');
  for (let i = 1; i < data.length; i++) if (data[i][0] === id) {
    const row = data[i].slice(); row[5] = status;
    await updateRow('Candidates', i + 1, row); return;
  }
}
async function addToArr(id, col, value) {
  const data = await getRows('Candidates');
  for (let i = 1; i < data.length; i++) if (data[i][0] === id) {
    const row = data[i].slice(); const cur = parseArr(row[col]);
    if (cur.indexOf(value) < 0) cur.push(value);
    row[col] = JSON.stringify(cur);
    await updateRow('Candidates', i + 1, row); return;
  }
}
const addSigned = (id, doc) => addToArr(id, 9, doc);
const addAgreed = (id, pol) => addToArr(id, 10, pol);

async function recordSignature(id, doc, signer, at, url) {
  await appendRow('Signatures', [id, doc, signer, at, url]);
}
async function appendLog(id, action, actor) {
  await appendRow('Logs', [id, action, actor, new Date().toISOString()]);
}
async function logsFor(id) {
  const data = await getRows('Logs'); const out = [];
  for (let i = 1; i < data.length; i++) if (data[i][0] === id)
    out.push({ action: data[i][1], actor: data[i][2], at: data[i][3] });
  return out.reverse();
}

/* ---------- Details (KYC + bank) ---------- */
const DCOLS = ['candidateId','pan','aadhaar','bankName','accName','accNo','ifsc','panFileUrl','aadhaarFileUrl','updatedAt'];
async function getDetails(id) {
  const data = await getRows('Details');
  for (let i = 1; i < data.length; i++) if (data[i][0] === id) {
    const o = {}; DCOLS.forEach((k, j) => o[k] = data[i][j] || '');
    o.panUploaded = !!o.panFileUrl; o.aadhaarUploaded = !!o.aadhaarFileUrl;
    return o;
  }
  return null;
}
async function saveDetails(id, d) {
  const data = await getRows('Details');
  let rowIdx = -1, cur = [id, '', '', '', '', '', '', '', '', ''];
  for (let i = 1; i < data.length; i++) if (data[i][0] === id) { rowIdx = i + 1; cur = data[i].slice(); break; }
  const set = (col, v) => { if (v != null) cur[DCOLS.indexOf(col)] = v; };
  set('pan', d.pan); set('aadhaar', d.aadhaar); set('bankName', d.bankName);
  set('accName', d.accName); set('accNo', d.accNo); set('ifsc', d.ifsc);
  cur[DCOLS.indexOf('updatedAt')] = new Date().toISOString();
  if (rowIdx < 0) await appendRow('Details', cur); else await updateRow('Details', rowIdx, cur);
}
async function setKycFile(id, kind, url) {
  const data = await getRows('Details');
  let rowIdx = -1, cur = [id, '', '', '', '', '', '', '', '', ''];
  for (let i = 1; i < data.length; i++) if (data[i][0] === id) { rowIdx = i + 1; cur = data[i].slice(); break; }
  cur[DCOLS.indexOf(kind === 'aadhaar' ? 'aadhaarFileUrl' : 'panFileUrl')] = url;
  cur[DCOLS.indexOf('updatedAt')] = new Date().toISOString();
  if (rowIdx < 0) await appendRow('Details', cur); else await updateRow('Details', rowIdx, cur);
}

/* ---------- Esign tracking ---------- */
async function upsertEsign(candidateId, document, docId, status, signUrl) {
  const data = await getRows('Esign');
  for (let i = 1; i < data.length; i++) if (data[i][0] === candidateId && data[i][1] === document) {
    await updateRow('Esign', i + 1, [candidateId, document, docId, status, signUrl || '', new Date().toISOString()]); return;
  }
  await appendRow('Esign', [candidateId, document, docId, status, signUrl || '', new Date().toISOString()]);
}
async function getEsign(candidateId, document) {
  const data = await getRows('Esign');
  for (let i = 1; i < data.length; i++) if (data[i][0] === candidateId && data[i][1] === document)
    return { candidateId, document, leegalityDocId: data[i][2], status: data[i][3], signUrl: data[i][4] };
  return null;
}
async function findEsignByDoc(docId) {
  const data = await getRows('Esign');
  for (let i = 1; i < data.length; i++) if (data[i][2] === docId)
    return { candidateId: data[i][0], document: data[i][1], leegalityDocId: data[i][2], status: data[i][3] };
  return null;
}

/* ---------- Settings / portal ---------- */
let _portalCache = null, _portalAt = 0;
async function getPortal() {
  if (_portalCache && Date.now() - _portalAt < 15000) return _portalCache;
  let data = [];
  try { data = await getRows('Settings'); } catch (e) { return defaultPortal(); }
  let result = defaultPortal();
  for (let i = 1; i < data.length; i++) if (data[i][0] === 'portal') {
    try {
      const p = JSON.parse(data[i][1]); const d = defaultPortal();
      if (!p.documents) p.documents = d.documents;
      if (!p.policies) p.policies = d.policies;
      if (!p.emails) p.emails = d.emails;
      if (!p.esign) p.esign = d.esign;
      if (!p.roleSets) p.roleSets = [];
      if (p.collectDetails === undefined) p.collectDetails = true;
      result = p;
    } catch (e) { result = defaultPortal(); }
    break;
  }
  _portalCache = result; _portalAt = Date.now();
  return result;
}
async function savePortal(portal) {
  _portalCache = portal; _portalAt = Date.now();
  const data = await getRows('Settings');
  for (let i = 1; i < data.length; i++) if (data[i][0] === 'portal') {
    await updateRow('Settings', i + 1, ['portal', JSON.stringify(portal)]); return portal;
  }
  await appendRow('Settings', ['portal', JSON.stringify(portal)]); return portal;
}

/* ---------- Drive ---------- */
async function candidateFolder(name) {
  const drive = driveApi();
  const q = `'${PARENT_FOLDER_ID}' in parents and name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await drive.files.list({ q, fields: 'files(id,name)', supportsAllDrives: true, includeItemsFromAllDrives: true });
  if (r.data.files && r.data.files.length) return r.data.files[0].id;
  const c = await drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [PARENT_FOLDER_ID] }, fields: 'id', supportsAllDrives: true });
  return c.data.id;
}
async function subFolder(parentId, name) {
  const drive = driveApi();
  const q = `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await drive.files.list({ q, fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true });
  if (r.data.files && r.data.files.length) return r.data.files[0].id;
  const c = await drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }, fields: 'id', supportsAllDrives: true });
  return c.data.id;
}
const { Readable } = require('stream');
async function uploadFile(folderId, filename, mime, buffer) {
  const drive = driveApi();
  const c = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: mime, body: Readable.from(buffer) },
    fields: 'id,webViewLink', supportsAllDrives: true
  });
  return c.data;
}
async function savePdf(candidateName, docName, buffer) {
  const folder = await candidateFolder(candidateName);
  const stamp = new Date().toISOString().slice(0, 10);
  return uploadFile(folder, `${docName} — signed ${stamp}.pdf`, 'application/pdf', buffer);
}
async function saveKyc(candidateName, label, mime, buffer) {
  const folder = await candidateFolder(candidateName);
  const kyc = await subFolder(folder, 'KYC');
  const ext = /pdf/i.test(mime) ? 'pdf' : (/png/i.test(mime) ? 'png' : 'jpg');
  const stamp = new Date().toISOString().slice(0, 10);
  return uploadFile(kyc, `${label} — ${stamp}.${ext}`, mime, buffer);
}
async function listCandidateFiles(candidateName) {
  const drive = driveApi();
  const folder = await candidateFolder(candidateName);
  const r = await drive.files.list({ q: `'${folder}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
    fields: 'files(name,webViewLink,modifiedTime)', supportsAllDrives: true, includeItemsFromAllDrives: true });
  return (r.data.files || []).map(f => ({ name: f.name, url: f.webViewLink, updated: f.modifiedTime }));
}

/* ---------- Gmail ---------- */
async function sendEmail(to, subject, htmlBody) {
  if (!GMAIL_SENDER) { console.log('GMAIL_SENDER not set — skipping email to ' + to); return; }
  const gmail = google.gmail({ version: 'v1', auth: jwt(['https://www.googleapis.com/auth/gmail.send'], GMAIL_SENDER) });
  const company = (process.env.COMPANY || 'Healthy Mind by Avik');
  const raw = [
    `From: ${company} <${GMAIL_SENDER}>`, `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', htmlBody
  ].join('\r\n');
  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
}

/* ---------- one-time setup: create tabs + headers (runs once per warm instance) ---------- */
let _tabsEnsured = false;
async function ensureTabs() {
  if (_tabsEnsured) return { ok: true, cached: true };
  const api = sheetsApi();
  const meta = await api.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const have = (meta.data.sheets || []).map(s => s.properties.title);
  const need = {
    Candidates: ['id','name','email','role','joining','status','token','created','expires','signed','agreed'],
    Signatures: ['candidateId','document','signerName','signedAt','fileUrl'],
    Logs: ['candidateId','action','actor','at'],
    Details: ['candidateId','pan','aadhaar','bankName','accName','accNo','ifsc','panFileUrl','aadhaarFileUrl','updatedAt'],
    Esign: ['candidateId','document','leegalityDocId','status','signUrl','updatedAt'],
    Settings: ['key','json']
  };
  const toAdd = Object.keys(need).filter(t => have.indexOf(t) < 0);
  if (toAdd.length) {
    await api.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID,
      requestBody: { requests: toAdd.map(t => ({ addSheet: { properties: { title: t } } })) } });
  }
  for (const t of Object.keys(need)) {
    const rows = await getRows(t);
    if (!rows.length) await appendRow(t, need[t]);
  }
  _tabsEnsured = true;
  return { created: toAdd, ok: true };
}

module.exports = {
  SHEET_ID, PARENT_FOLDER_ID,
  allCandidates, getCandidate, findByToken, insertCandidate, setStatus, addSigned, addAgreed,
  recordSignature, appendLog, logsFor, getDetails, saveDetails, setKycFile,
  upsertEsign, getEsign, findEsignByDoc, getPortal, savePortal, ensureTabs,
  candidateFolder, savePdf, saveKyc, listCandidateFiles, sendEmail
};
