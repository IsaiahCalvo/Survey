// Survey report as an Excel workbook (nightly flag 'survey-report'), from the
// template's report kit: a Summary sheet (title, totals, the table per
// category and a real Excel chart of it), an Issues sheet and an Items sheet
// (one row per item, as the CSV). ExcelJS cannot write charts, so the chart
// parts are added to the saved file with JSZip; the chart reads its numbers
// from the Summary cells, so it stays live when someone edits them.
import { surveyReportPlan } from './surveyReportPptx.js';
import { reportKitFor } from './reportKits/index.js';
import { summarizeSurvey } from './surveySummary.js';

const STATUS = [['Done', '0CA30C'], ['Partly done', 'FAB219'], ['Not started', 'A6A6A6']];
const STATUS_LABEL = { done: 'Done', partly: 'Partly done', notStarted: 'Not started' };
const MUTED = 'FF5B6270';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (n) => String.fromCharCode(64 + n); // 1 -> A (the report uses A..I)
const ref = (sheet, c1, r1, c2 = c1, r2 = r1) => `'${sheet}'!$${col(c1)}$${r1}${c2 === c1 && r2 === r1 ? '' : `:$${col(c2)}$${r2}`}`;
const strCache = (values) => `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
const numCache = (values) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`;
const fill = (hex) => `<c:spPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></c:spPr>`;

/** Chart XML: stacked bars per category, or a pie of the whole survey. */
export function surveyReportChartXml(chart) {
  let plot;
  if (chart.style === 'pie') {
    const { sheet, labelsAt, valuesAt, labels, values } = chart;
    plot = `<c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>`
      + `<c:tx><c:v>Items</c:v></c:tx>`
      + STATUS.map(([, hex], i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/>${fill(hex)}</c:dPt>`).join('')
      + `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>`
      + `<c:cat><c:strRef><c:f>${ref(sheet, ...labelsAt)}</c:f>${strCache(labels)}</c:strRef></c:cat>`
      + `<c:val><c:numRef><c:f>${ref(sheet, ...valuesAt)}</c:f>${numCache(values)}</c:numRef></c:val>`
      + `</c:ser><c:firstSliceAng val="0"/></c:pieChart>`;
  } else {
    const { sheet, headerRow, firstRow, lastRow, categories, series } = chart;
    // Item counts: whole-number steps (a survey of one item read 0, 0.2, 0.4...).
    const most = Math.max(0, ...categories.map((_, row) => series.reduce((sum, s) => sum + (Number(s.values[row]) || 0), 0)));
    const step = Math.max(1, Math.ceil(most / 5));
    plot = `<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>`
      + series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>`
        + `<c:tx><c:strRef><c:f>${ref(sheet, s.col, headerRow)}</c:f>${strCache([s.name])}</c:strRef></c:tx>`
        + `${fill(s.color)}<c:invertIfNegative val="0"/>`
        + `<c:cat><c:strRef><c:f>${ref(sheet, 1, firstRow, 1, lastRow)}</c:f>${strCache(categories)}</c:strRef></c:cat>`
        + `<c:val><c:numRef><c:f>${ref(sheet, s.col, firstRow, s.col, lastRow)}</c:f>${numCache(s.values)}</c:numRef></c:val>`
        + `</c:ser>`).join('')
      + `<c:gapWidth val="60"/><c:overlap val="100"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>`
      // Categories read top-down like the table; the value axis sits at the bottom.
      + `<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>`
      + `<c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="5002"/><c:crosses val="autoZero"/>`
      + `<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
      + `<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>`
      + `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E6E6E6"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>`
      + `<c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="5001"/><c:crosses val="max"/><c:crossBetween val="between"/><c:majorUnit val="${step}"/></c:valAx>`;
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<c:roundedCorners val="0"/><c:chart>'
    + `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>${xml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
    + `<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}</c:plotArea>`
    + `<c:legend><c:legendPos val="${chart.style === 'pie' ? 'r' : 't'}"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>`
    + '</c:chart></c:chartSpace>';
}

function drawingXml({ fromRow, toRow, toCol }) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + '<xdr:twoCellAnchor editAs="oneCell">'
    + `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
    + `<xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
    + '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Survey progress chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>'
    + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
    + '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>'
    + '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Adds one chart, anchored on the first sheet, to a saved workbook. */
export async function addChartToWorkbook(JSZip, buffer, chart, anchor) {
  const zip = await JSZip.loadAsync(buffer);
  zip.file('xl/charts/chart1.xml', surveyReportChartXml(chart));
  zip.file('xl/drawings/drawing1.xml', drawingXml(anchor));
  zip.file('xl/drawings/_rels/drawing1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/chart" Target="../charts/chart1.xml"/></Relationships>`);

  const relsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
  const relsFile = zip.file(relsPath);
  const rels = relsFile ? await relsFile.async('string')
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  zip.file(relsPath, rels.replace('</Relationships>', `<Relationship Id="rIdSurveyChart" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`));

  let sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  if (!/xmlns:r=/.test(sheet.slice(0, sheet.indexOf('>', sheet.indexOf('<worksheet'))))) {
    sheet = sheet.replace('<worksheet', `<worksheet xmlns:r="${REL}"`);
  }
  // <drawing> goes before these, in the schema's order.
  const before = ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>']
    .map((tag) => sheet.indexOf(tag)).filter((i) => i >= 0);
  const at = Math.min(...before);
  sheet = `${sheet.slice(0, at)}<drawing r:id="rIdSurveyChart"/>${sheet.slice(at)}`;
  zip.file('xl/worksheets/sheet1.xml', sheet);

  let types = await zip.file('[Content_Types].xml').async('string');
  types = types.replace('</Types>', '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
    + '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
  zip.file('[Content_Types].xml', types);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** The workbook, as bytes. ExcelJS and JSZip are passed in (loaded on demand). */
export async function buildSurveyReportXlsx({ ExcelJS, JSZip }, input) {
  const plan = surveyReportPlan(input);
  const kit = input?.kit || reportKitFor(input?.template);
  const types = new Set(kit.blocks.map((b) => b.type));
  const chartBlock = kit.blocks.find((b) => b.type === 'chart');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Survey';
  wb.title = plan.title;

  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 36 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 4 }, { width: 14 }, { width: 10 }];
  summary.getCell('A1').value = plan.title;
  summary.getCell('A1').font = { bold: true, size: 16 };
  summary.getCell('A2').value = plan.subtitle;
  summary.getCell('A2').font = { color: { argb: MUTED } };
  summary.getCell('A3').value = plan.headline;
  let row = 5;
  if (types.has('totals')) {
    plan.tiles.forEach((tile, i) => {
      summary.getCell(row, i + 1).value = tile.label;
      summary.getCell(row, i + 1).font = { color: { argb: MUTED } };
      summary.getCell(row + 1, i + 1).value = tile.value;
      summary.getCell(row + 1, i + 1).font = { bold: true, size: 14 };
      summary.getCell(row + 1, i + 1).alignment = { horizontal: 'left' };
    });
    row += 3;
  }
  let chart = null;
  let anchorRow = row;
  if (types.has('table') || types.has('chart')) {
    const headerRow = row;
    const head = ['Category', 'Done', 'Partly done', 'Not started', 'Items', 'With issues'];
    head.forEach((h, i) => {
      const cell = summary.getCell(headerRow, i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.border = { bottom: { style: 'thin' } };
      if (i) cell.alignment = { horizontal: 'right' };
    });
    // plan.categoryRows: name, items, done, partly, notStarted, issues.
    plan.categoryRows.forEach(([name, items, done, partly, notStarted, issues], i) => {
      summary.getRow(headerRow + 1 + i).values = [name, done, partly, notStarted, items, issues];
    });
    const firstRow = headerRow + 1;
    const lastRow = headerRow + Math.max(1, plan.categoryRows.length);
    anchorRow = lastRow + 1;
    if (chartBlock && plan.categoryRows.length) {
      if (chartBlock.style === 'pie') {
        const t = plan.totals;
        const values = [t.done, t.partly, t.notStarted];
        summary.getCell(headerRow, 8).value = 'Status';
        summary.getCell(headerRow, 9).value = 'Items';
        [8, 9].forEach((c) => { summary.getCell(headerRow, c).font = { bold: true }; summary.getCell(headerRow, c).border = { bottom: { style: 'thin' } }; });
        STATUS.forEach(([label], i) => {
          summary.getCell(firstRow + i, 8).value = label;
          summary.getCell(firstRow + i, 9).value = values[i];
        });
        anchorRow = Math.max(anchorRow, firstRow + 3);
        chart = {
          style: 'pie', title: 'Survey progress', sheet: 'Summary',
          labelsAt: [8, firstRow, 8, firstRow + 2], valuesAt: [9, firstRow, 9, firstRow + 2],
          labels: STATUS.map(([label]) => label), values,
        };
      } else {
        chart = {
          style: 'stacked', title: 'Progress by category', sheet: 'Summary', headerRow, firstRow, lastRow,
          categories: plan.chart.categories,
          series: plan.chart.series.map((s, i) => ({ ...s, col: i + 2 })),
        };
      }
    }
  }

  if (types.has('issues')) {
    const issues = wb.addWorksheet('Issues');
    issues.columns = [{ header: 'Category', width: 30 }, { header: 'Item', width: 24 }, { header: 'Lines with a problem answer', width: 80 }];
    issues.getRow(1).font = { bold: true };
    plan.issueRows.forEach((r) => issues.addRow([r.category, r.item, r.lines]));
    if (!plan.issueRows.length) issues.addRow(['No issues found.']);
  }

  const items = wb.addWorksheet('Items');
  items.columns = [
    { header: 'Category', width: 30 }, { header: 'Item', width: 24 }, { header: 'Status', width: 14 },
    { header: 'Lines answered', width: 15 }, { header: 'Lines', width: 8 }, { header: 'Issues', width: 60 },
  ];
  items.getRow(1).font = { bold: true };
  for (const c of summarizeSurvey({ template: input?.template, markers: input?.markers, rows: true }).categories) {
    for (const r of c.rows) items.addRow([c.name, r.name, STATUS_LABEL[r.status], r.answered, r.total, r.issues.map((l) => `${l.text}: ${l.answer}`).join('; ')]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  if (!chart) return new Uint8Array(buffer);
  return addChartToWorkbook(JSZip, buffer, chart, { fromRow: anchorRow + 1, toRow: anchorRow + 22, toCol: 6 });
}

/** "<template> report.xlsx" without unsafe characters. */
export function surveyReportXlsxFileName(template) {
  const base = String(template?.name || 'Survey').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Survey';
  return `${base} report.xlsx`;
}

export async function downloadSurveyReportXlsx(input) {
  const [{ default: ExcelJS }, { default: JSZip }] = await Promise.all([import('exceljs'), import('jszip')]);
  const bytes = await buildSurveyReportXlsx({ ExcelJS, JSZip }, input);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = surveyReportXlsxFileName(input?.template);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
