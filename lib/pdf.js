// Signed-PDF generation with pdf-lib (works server-side, no browser).
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

function fillTokens(s, company) { return String(s || '').replace(/\{\{company\}\}/g, company); }

/**
 * Build a signed PDF buffer.
 * docDef = { name, intro, sections:[{h,p}] }
 * signature = { type:'typed'|'drawn'|'esign', value } (value: name string OR data:image/png;base64,...)
 */
async function buildSigned(candidate, docDef, signature, when, company) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pine = rgb(0.035, 0.36, 0.25);
  const ink = rgb(0.086, 0.125, 0.106);
  const gray = rgb(0.36, 0.40, 0.38);

  let page = pdf.addPage([595, 842]); // A4
  const M = 56; let y = 786;
  const width = 595 - M * 2;

  function wrap(text, f, size, maxW) {
    const words = String(text).split(/\s+/); const lines = []; let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (f.widthOfTextAtSize(t, size) > maxW && line) { lines.push(line); line = w; }
      else line = t;
    }
    if (line) lines.push(line); return lines;
  }
  function draw(text, f, size, color, gap) {
    for (const ln of wrap(text, f, size, width)) {
      if (y < M + 80) { page = pdf.addPage([595, 842]); y = 786; }
      page.drawText(ln, { x: M, y, size, font: f, color }); y -= size + 4;
    }
    y -= (gap || 0);
  }

  draw(company, bold, 12, pine, 4);
  draw(docDef.name, bold, 22, ink, 10);
  if (docDef.intro) draw(fillTokens(docDef.intro, company), font, 11, gray, 8);
  (docDef.sections || []).forEach(s => { draw(fillTokens(s.h, company), bold, 12, ink, 2); draw(fillTokens(s.p, company), font, 11, gray, 8); });

  y -= 10;
  if (y < M + 140) { page = pdf.addPage([595, 842]); y = 786; }
  page.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 1, color: rgb(0.8, 0.83, 0.81) }); y -= 24;
  draw('Signed by', bold, 12, ink, 2);
  draw(candidate.name + '  (' + candidate.email + ')', font, 11, gray, 10);

  // signature
  if (signature && signature.type === 'drawn' && /^data:image/.test(signature.value)) {
    try {
      const b64 = signature.value.split(',')[1];
      const bytes = Buffer.from(b64, 'base64');
      const img = /png/i.test(signature.value) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const w = 180, h = w * (img.height / img.width);
      if (y < M + h + 30) { page = pdf.addPage([595, 842]); y = 786; }
      page.drawImage(img, { x: M, y: y - h, width: w, height: h }); y -= h + 8;
    } catch (e) { draw(signature.value || candidate.name, bold, 18, pine, 6); }
  } else if (signature && signature.type === 'esign') {
    draw('Signed electronically via Leegality (Aadhaar eSign).', font, 11, pine, 6);
  } else {
    draw(String((signature && signature.value) || candidate.name), bold, 20, pine, 6);
  }

  const stamp = when.toUTCString();
  draw('Date & time: ' + stamp, font, 10, gray, 0);
  // Note: visitor IP is not captured in this deployment; signer identity + timestamp are recorded.

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

module.exports = { buildSigned, fillTokens };
