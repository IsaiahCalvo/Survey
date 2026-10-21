// Entry for the /tools pages. The hub only needs the styles; a tool page loads
// the tool code (pdf-lib, pdf.js) on demand.
import './tools.css';

if (document.getElementById('tool')) import('./app.js');
