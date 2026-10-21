// Builds the web page for PDF to HTML. "Looks like the PDF": each page is a
// picture with the page's words laid over it in see-through letters, so they
// can be selected, copied and found with Ctrl+F. "Text only": headings and
// paragraphs. Pure string building; the tool def does the drawing.

export const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[c]));

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const r = (n) => Math.round(n * 1000) / 1000;

// Spans for a page's text items. `viewport` is pdf.js's at scale 1 (it carries
// the page's rotation); every place and size is a share of the page width
// (cqw), so the words stay on the picture at any window size. Like pdf.js's
// own text layer, the letters go where the PDF put them and a little script in
// the page stretches each span to the width the PDF says it has.
export function textSpans(items, styles, viewport) {
  const W = viewport.width;
  const H = viewport.height;
  const out = [];
  for (const it of items) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const st = styles[it.fontName] || {};
    const tx = mul(viewport.transform, it.transform);
    let angle = Math.atan2(tx[1], tx[0]);
    if (st.vertical) angle += Math.PI / 2;
    const size = Math.hypot(tx[2], tx[3]);
    if (!size) continue;
    const ascent = size * (st.ascent || (st.descent ? 1 + st.descent : 0.8));
    const left = angle === 0 ? tx[4] : tx[4] + ascent * Math.sin(angle);
    const top = angle === 0 ? tx[5] - ascent : tx[5] - ascent * Math.cos(angle);
    const width = (st.vertical ? it.height : it.width) * viewport.scale;
    const family = /^[a-z -]+$/i.test(st.fontFamily || '') ? st.fontFamily : 'sans-serif';
    let style = `left:${r(left / W * 100)}%;top:${r(top / H * 100)}%;font-size:${r(size / W * 100)}cqw;font-family:${family}`;
    if (angle) style += `;transform:rotate(${r(angle)}rad)`;
    out.push(`<span style="${style}"${width > 0 ? ` data-w="${r(width / W * 100)}"` : ''}${angle ? ` data-r="${r(angle)}"` : ''}>${escapeHtml(it.str)}</span>`);
  }
  return out.join('');
}

export function pageSection({
  n, width, height, image, spans,
}) {
  return `<section class="pg" id="page-${n}" style="aspect-ratio:${r(width)}/${r(height)};width:min(100%,${Math.round(width * 4 / 3)}px)">`
    + `<img src="${image}" alt="Page ${n}">${spans}</section>\n`;
}

// Stretch each word span to the width the PDF gave it, once the page is laid
// out. Widths are shares of the page, so one pass holds at every size.
const FIT_SCRIPT = `<script>
(function(){var s=document.querySelectorAll('.pg span[data-w]'),k=[];
for(var i=0;i<s.length;i++){var pw=s[i].parentNode.clientWidth,w=s[i].offsetWidth;k.push(w?s[i].dataset.w*pw/100/w:1);}
for(var j=0;j<s.length;j++){var t=s[j].dataset.r?'rotate('+s[j].dataset.r+'rad) ':'';s[j].style.transform=t+'scaleX('+k[j]+')';}})();
</script>`;

const LOOK_CSS = `body{margin:0;background:#e8e8e8;font-family:sans-serif}
.pg{position:relative;margin:16px auto;container-type:inline-size;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);overflow:hidden}
.pg img{position:absolute;inset:0;width:100%;height:100%;user-select:none;-webkit-user-select:none}
.pg span{position:absolute;white-space:pre;line-height:1;color:transparent;transform-origin:0 0;cursor:text}
.pg span::selection{background:rgba(0,90,255,.3)}
@media print{body{background:#fff}.pg{margin:0 auto;box-shadow:none;break-after:page}}`;

const TEXT_CSS = `body{margin:0;background:#fff;color:#1a1a1a;font:17px/1.6 Georgia,serif}
main{max-width:46em;margin:0 auto;padding:24px 16px 64px}
h1,h2{font-family:Arial,sans-serif;line-height:1.25}
section+section{border-top:1px solid #ddd;margin-top:2em;padding-top:1em}`;

export function htmlHead(title, mode) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${mode === 'text' ? TEXT_CSS : LOOK_CSS}
</style>
</head>
<body>
${mode === 'text' ? '<main>\n' : ''}`;
}

export function htmlFoot(mode) {
  return mode === 'text' ? '</main>\n</body>\n</html>\n' : `${FIT_SCRIPT}\n</body>\n</html>\n`;
}

// paras: markHeadings() output for one page.
export function textSection(n, paras) {
  const body = paras.map((p) => {
    const tag = p.heading === 1 ? 'h1' : p.heading === 2 ? 'h2' : 'p';
    return `<${tag}>${escapeHtml(p.text)}</${tag}>`;
  }).join('\n');
  return `<section id="page-${n}">\n${body}\n</section>\n`;
}
