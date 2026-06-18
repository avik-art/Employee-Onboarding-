// Onboarding portal API — Vercel serverless function.
// POST /api  body: { action, args: [...] }  →  { result } | { error }
const store = require('../lib/store');
const { buildSigned } = require('../lib/pdf');
const mail = require('../lib/mail');
const zoho = require('../lib/zoho');

const ADMIN_KEY = process.env.ADMIN_KEY || '';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function docsForRole(portal, role) {
  const all = portal.documents.map(d => d.name);
  const set = (portal.roleSets || []).find(r => r.role && r.role === role);
  if (set) { const picked = all.filter(n => (set.documents || []).indexOf(n) >= 0); return picked.length ? picked : all; }
  return all;
}
function esignDocs(portal) { return (portal.esign && portal.esign.enabled) ? (portal.esign.documents || []) : []; }
function isEsignDoc(portal, name) { return esignDocs(portal).indexOf(name) >= 0; }
function portalDoc(portal, name) { return portal.documents.find(d => d.name === name) || null; }
function isExpired(c) { return new Date(c.expires).getTime() < Date.now(); }

async function requireCandidate(token) {
  const c = await store.findByToken(token);
  if (!c) throw new Error('Invalid link.');
  if (isExpired(c)) throw new Error('This link has expired.');
  return c;
}
function requireAdmin(key) { if (!ADMIN_KEY || key !== ADMIN_KEY) throw new Error('Admin access required.'); }

async function refreshStatus(portal, id) {
  const c = await store.getCandidate(id);
  const req = docsForRole(portal, c.role);
  const signed = c.signed || [];
  const docsDone = req.every(n => signed.indexOf(n) >= 0);
  const polDone = (c.agreed || []).length >= portal.policies.length;
  const needDetails = portal.collectDetails !== false;
  const d = needDetails ? (await store.getDetails(id)) : null;
  const detailsDone = !needDetails || (d && d.panUploaded && d.aadhaarUploaded && d.accNo && d.ifsc);
  let status = 'in_progress';
  if (docsDone && detailsDone && polDone) status = 'completed';
  else if (docsDone) status = 'signed';
  if (c.status !== 'completed') await store.setStatus(id, status);
}

async function createCandidate(portal, input, origin) {
  if (!input || !input.name || !input.email) throw new Error('Name and email are required.');
  const now = new Date();
  const token = (now.getTime().toString(36) + Math.random().toString(36).slice(2, 12)).replace(/[^a-z0-9]/gi, '');
  const expires = new Date(now.getTime() + (portal.linkTtlDays || 7) * 86400000);
  const id = 'c_' + now.getTime() + '_' + Math.floor(Math.random() * 1000);
  const row = { id, name: input.name, email: input.email, role: input.role || '', joining: input.joining || '',
    status: 'invited', token, created: now.toISOString(), expires: expires.toISOString(), signed: [], agreed: [] };
  await store.insertCandidate(row);
  const link = origin + '/?token=' + token;
  const m = mail.renderInvite(portal, row, link);
  try { await store.sendEmail(row.email, m.subject, m.html); } catch (e) { console.log('invite email failed: ' + e.message); }
  await store.appendLog(id, 'HR created candidate & sent link', input.email);
  row.link = link;
  return row;
}

const ACTIONS = {
  async getCandidateBoot([token], ctx) {
    const c = await requireCandidate(token);
    const p = ctx.portal;
    await store.appendLog(c.id, 'Opened onboarding link', '');
    const content = { documents: {}, policies: {} };
    p.documents.forEach(d => content.documents[d.name] = { intro: d.intro, sections: d.sections || [] });
    p.policies.forEach(pl => content.policies[pl.name] = { summary: pl.summary, body: pl.body });
    return {
      token, company: p.company, content, zoho: zoho.enabled(p),
      candidate: { name: c.name, firstName: (c.name || '').split(' ')[0], email: c.email, role: c.role, joining: c.joining },
      documents: docsForRole(p, c.role), esignDocs: esignDocs(p),
      policies: p.policies.map(pl => pl.name),
      collectDetails: p.collectDetails !== false,
      savedDetails: (await store.getDetails(c.id)) || {},
      signed: c.signed || [], agreed: c.agreed || []
    };
  },
  async candidateLogView([token, what]) { const c = await requireCandidate(token); await store.appendLog(c.id, 'Viewed ' + what, c.email); return true; },
  async candidateSignDocument([token, docName, signature], ctx) {
    const c = await requireCandidate(token); const p = ctx.portal;
    if (p.documents.map(d => d.name).indexOf(docName) < 0) throw new Error('Unknown document.');
    if (isEsignDoc(p, docName)) throw new Error('This document is signed via Leegality eSign.');
    const when = new Date();
    const pdf = await buildSigned(c, portalDoc(p, docName), signature, when, p.company);
    const file = await store.savePdf(c.name, docName, pdf);
    await store.addSigned(c.id, docName);
    await store.recordSignature(c.id, docName, c.name, when.toISOString(), file.webViewLink || '');
    await store.appendLog(c.id, 'Signed ' + docName, c.email);
    if (zoho.enabled(p)) { try { await zoho.upload(p, c.name, docName + ' — signed.pdf', pdf); await store.appendLog(c.id, 'Synced ' + docName + ' to Zoho WorkDrive', ''); } catch (z) { await store.appendLog(c.id, 'Zoho sync failed for ' + docName + ' — ' + z.message, ''); } }
    await refreshStatus(p, c.id);
    return { ok: true, fileUrl: file.webViewLink };
  },
  async candidatePreviewPdf([token, docName], ctx) {
    const c = await requireCandidate(token); const p = ctx.portal;
    if (p.documents.map(d => d.name).indexOf(docName) < 0) throw new Error('Unknown document.');
    const pdf = await buildSigned(c, portalDoc(p, docName), { type: 'preview', value: '' }, new Date(), p.company);
    await store.appendLog(c.id, 'Previewed ' + docName, c.email);
    return 'data:application/pdf;base64,' + pdf.toString('base64');
  },
  async candidateAgreePolicy([token, policyName], ctx) {
    const c = await requireCandidate(token); const p = ctx.portal;
    if (p.policies.map(x => x.name).indexOf(policyName) < 0) throw new Error('Unknown policy.');
    await store.addAgreed(c.id, policyName);
    await store.appendLog(c.id, 'Agreed to ' + policyName, c.email);
    await refreshStatus(p, c.id);
    return { ok: true };
  },
  async candidateUploadKyc([token, kind, base64, mime], ctx) {
    const c = await requireCandidate(token);
    if (['pan', 'aadhaar'].indexOf(kind) < 0) throw new Error('Unknown document type.');
    if (!base64) throw new Error('No file received.');
    const label = kind === 'aadhaar' ? 'Aadhaar' : 'PAN';
    const buf = Buffer.from(base64, 'base64');
    const file = await store.saveKyc(c.name, label, mime || 'image/jpeg', buf);
    await store.setKycFile(c.id, kind, file.webViewLink || '');
    await store.appendLog(c.id, 'Uploaded ' + label + ' document', c.email);
    if (zoho.enabled(ctx.portal)) { try { await zoho.upload(ctx.portal, c.name, label + ' document.' + (/pdf/i.test(mime) ? 'pdf' : 'jpg'), buf); } catch (z) { await store.appendLog(c.id, 'Zoho KYC sync failed — ' + z.message, ''); } }
    return { ok: true };
  },
  async candidateSaveDetails([token, details]) {
    const c = await requireCandidate(token); details = details || {};
    await store.saveDetails(c.id, {
      pan: (details.pan || '').toUpperCase(), aadhaar: details.aadhaar || '',
      bankName: details.bankName || '', accName: details.accName || '',
      accNo: details.accNo || '', ifsc: (details.ifsc || '').toUpperCase()
    });
    await store.appendLog(c.id, 'Submitted KYC & bank details', c.email);
    return { ok: true };
  },
  async candidateComplete([token], ctx) {
    const c = await requireCandidate(token);
    await store.setStatus(c.id, 'completed');
    await store.appendLog(c.id, 'Completed onboarding', c.email);
    const m = mail.renderCompletion(ctx.portal, c);
    try { await store.sendEmail(c.email, m.subject, m.html); } catch (e) {}
    return { ok: true };
  },
  async candidateMyFiles([token]) {
    const c = await requireCandidate(token);
    return (await store.listCandidateFiles(c.name)).map(f => ({ name: f.name, url: f.url }));
  },
  async candidateStartEsign([token, docName], ctx) {
    await requireCandidate(token);
    if (!process.env.LEEGALITY_AUTH_TOKEN) throw new Error('eSign is not configured on this deployment yet.');
    const leg = require('../lib/leegality');
    return leg.start(ctx.portal, token, docName);
  },
  async candidateEsignStatus([token, docName]) {
    const c = await requireCandidate(token);
    if ((c.signed || []).indexOf(docName) >= 0) return 'signed';
    const row = await store.getEsign(c.id, docName);
    return row ? row.status : 'none';
  },

  async adminLogin([email, password], ctx) {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Admin login is not configured (set ADMIN_EMAIL and ADMIN_PASSWORD).');
    if ((email || '').toLowerCase() !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) throw new Error('Wrong email or password.');
    const p = ctx.portal;
    try { await store.ensureTabs(); } catch (e) {}
    return { key: ADMIN_KEY, company: p.company, ttl: p.linkTtlDays, docCount: p.documents.length, isSuperAdmin: true, adminKey: ADMIN_KEY, hrEmail: ADMIN_EMAIL };
  },
  async getAdminBoot([key], ctx) {
    requireAdmin(key); const p = ctx.portal;
    try { await store.ensureTabs(); } catch (e) {}
    return { company: p.company, ttl: p.linkTtlDays, docCount: p.documents.length, isSuperAdmin: true, adminKey: key, hrEmail: ADMIN_EMAIL || 'Admin' };
  },
  async adminListCandidates([key]) { requireAdmin(key); return store.allCandidates(); },
  async adminCreateCandidate([input, key], ctx) { requireAdmin(key); return createCandidate(ctx.portal, input, ctx.origin); },
  async adminImportCandidates([rows, key], ctx) {
    requireAdmin(key);
    if (!rows || !rows.length) throw new Error('No rows to import.');
    let created = 0; const skipped = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try { if (!r.name || !r.email) { skipped.push('Row ' + (i + 1) + ': missing name/email'); continue; } await createCandidate(ctx.portal, r, ctx.origin); created++; }
      catch (e) { skipped.push('Row ' + (i + 1) + ': ' + e.message); }
    }
    return { created, skipped };
  },
  async adminCandidateDetail([id, key]) {
    requireAdmin(key);
    const c = await store.getCandidate(id); if (!c) throw new Error('Candidate not found.');
    c.log = await store.logsFor(id);
    c.files = await store.listCandidateFiles(c.name);
    c.details = (await store.getDetails(id)) || null;
    return c;
  },
  async adminResend([id, key], ctx) {
    requireAdmin(key);
    const c = await store.getCandidate(id); if (!c) throw new Error('Candidate not found.');
    const link = ctx.origin + '/?token=' + c.token;
    const m = mail.renderInvite(ctx.portal, c, link);
    await store.sendEmail(c.email, m.subject, m.html);
    await store.appendLog(id, 'HR resent onboarding link', '');
    return true;
  },
  async adminGetPortal([key], ctx) { requireAdmin(key); return ctx.portal; },
  async adminSavePortal([portal, key]) { requireAdmin(key); await store.savePortal(portal); return store.getPortal(); },
  async adminResetPortal([key]) { requireAdmin(key); const { defaultPortal } = require('../lib/config'); return store.savePortal(defaultPortal()); },
  async adminSetup([key]) { requireAdmin(key); return store.ensureTabs(); }
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { res.status(400).json({ error: 'Bad JSON' }); return; } }
  body = body || {};
  const { action, args } = body;
  if (!ACTIONS[action]) { res.status(404).json({ error: 'Unknown action: ' + action }); return; }
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = proto + '://' + (req.headers['x-forwarded-host'] || req.headers.host || '');
  try {
    const portal = await store.getPortal();
    const result = await ACTIONS[action](args || [], { portal, origin });
    res.status(200).json({ result });
  } catch (e) {
    res.status(200).json({ error: e.message || String(e) });
  }
};
