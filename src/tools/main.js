// Entry for the /tools pages. The hub loads its small search script; a tool
// page loads the tool code (pdf-lib, pdf.js) on demand.
import './tools.css';

if (document.getElementById('tool')) import('./app.js');
else if (document.querySelector('[data-hub]')) import('./hub.js');
