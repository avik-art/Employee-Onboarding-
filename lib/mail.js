// Branded invite + completion emails, rendered from the editable portal copy.
function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function apply(tpl, map) { return String(tpl || '').replace(/\{\{\w+\}\}/g, m => (map[m] != null ? map[m] : m)); }

function tokens(c, link, company) {
  const first = (c.name || '').split(' ')[0] || 'there';
  let expires = c.expires;
  try { expires = new Date(c.expires).toDateString(); } catch (e) {}
  return { '{{firstName}}': first, '{{name}}': c.name || '', '{{company}}': company,
    '{{link}}': link || '', '{{role}}': c.role || '', '{{joining}}': c.joining || '', '{{expires}}': expires };
}

function btn(label, url) {
  return `<p style="margin:22px 0"><a href="${url}" style="background:#095d40;color:#fff;text-decoration:none;font-weight:600;padding:13px 26px;border-radius:999px;display:inline-block">${esc(label)}</a></p>`;
}
function shell(inner, company) {
  return `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;background:#faf7f0;border-radius:20px;padding:34px 30px;color:#3a453e;line-height:1.55">${inner}<p style="margin-top:26px;color:#79847d;font-size:12px">${esc(company)}</p></div>`;
}
function bodyToHtml(body, map, company) {
  const html = String(body).split(/\n/).map(ln => {
    const t = ln.trim();
    if (!t) return '<div style="height:10px"></div>';
    if (map['{{link}}'] && t === map['{{link}}']) return btn('Start onboarding', t);
    if (/^https?:\/\//.test(t)) return btn('Open link', t);
    return `<p style="margin:0 0 10px">${esc(t)}</p>`;
  }).join('');
  return shell(html, company);
}

function renderInvite(portal, c, link) {
  const company = portal.company; const map = tokens(c, link, company); const e = portal.emails || {};
  return { subject: apply(e.inviteSubject || 'Welcome to {{company}}', map), html: bodyToHtml(apply(e.inviteBody || '{{link}}', map), map, company) };
}
function renderCompletion(portal, c) {
  const company = portal.company; const map = tokens(c, '', company); const e = portal.emails || {};
  return { subject: apply(e.completionSubject || 'You\u2019re all set', map), html: bodyToHtml(apply(e.completionBody || 'Thank you, {{firstName}}.', map), map, company) };
}

module.exports = { renderInvite, renderCompletion };
