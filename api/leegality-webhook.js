// Leegality webhook (Vercel) — stores the signed PDF + marks the document signed.
// Set your Leegality callback URL to:  https://YOUR-SITE/api/leegality-webhook
const store = require('../lib/store');
const leg = require('../lib/leegality');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  if (process.env.LEEGALITY_WEBHOOK_SECRET) {
    const got = (req.query && (req.query.secret || req.query.token)) || '';
    if (got !== process.env.LEEGALITY_WEBHOOK_SECRET) { res.status(403).send('forbidden'); return; }
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const documentId = leg.pick(body, ['documentId', 'data.documentId', 'data.id', 'id']);
  const signedUrl = leg.pick(body, ['signedFileUrl', 'data.signedFileUrl', 'data.fileUrl', 'fileUrl', 'data.documentUrl']);
  const status = leg.pick(body, ['status', 'data.status', 'event', 'eventType']) || '';
  if (!documentId) { res.status(200).send('ignored'); return; }
  if (!/sign|complete|success/i.test(String(status)) && !signedUrl) { res.status(200).send('pending'); return; }
  try {
    const portal = await store.getPortal();
    await leg.onSigned(portal, documentId, signedUrl);
    res.status(200).send('ok');
  } catch (e) {
    res.status(200).send('error: ' + (e.message || e));
  }
};
