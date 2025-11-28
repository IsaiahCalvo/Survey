// Test deletion workflow - simulating deleting an item from Excel
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

async function testDeletion() {
  console.log('=== TESTING DELETION WORKFLOW ===\n');

  // Step 1: Create initial export with 3 cameras
  console.log('Step 1: Creating export with 3 cameras...');
  const workbook1 = new ExcelJS.Workbook();
  const worksheet1 = workbook1.addWorksheet('Test Category - Module');

  // Add metadata row (hidden)
  const metadataRow = worksheet1.addRow([
    'CHANGED_BY_COLUMN',
    'CHANGED_DATE_COLUMN',
    'METADATA_HEADER',
    'checklist-1',
    'BIC_COLUMN',
    'NOTES_COLUMN',
    'HIGHLIGHT_ID_COLUMN',
    'CATEGORY_ID_COLUMN',
    'MODULE_ID_COLUMN'
  ]);
  metadataRow.hidden = true;

  // Add header row
  worksheet1.addRow([
    'Changed By',
    'Changed Date',
    'Item',
    'Item 1',
    'Ball in Court',
    'Notes',
    'ID',
    'Category ID',
    'Module ID'
  ]);

  // Add data for 3 cameras
  worksheet1.addRow(['User1', '1/1/2025', 'Camera 1', 'Y', 'Contractor', 'First', 'hl-camera-1', 'cat-1', 'mod-1']);
  worksheet1.addRow(['User2', '1/2/2025', 'Camera 2', 'N', 'Owner', 'Second', 'hl-camera-2', 'cat-1', 'mod-1']);
  worksheet1.addRow(['User3', '1/3/2025', 'Camera 3', 'Y', 'Contractor', 'Third', 'hl-camera-3', 'cat-1', 'mod-1']);

  await workbook1.xlsx.writeFile('test-3-cameras.xlsx');
  console.log('✓ Created test-3-cameras.xlsx with Camera 1, 2, and 3\n');

  // Step 2: Simulate user deleting Camera 2 from Excel
  console.log('Step 2: Simulating user deleting Camera 2 row...');
  const workbook2 = new ExcelJS.Workbook();
  await workbook2.xlsx.readFile('test-3-cameras.xlsx');
  const worksheet2 = workbook2.getWorksheet('Test Category - Module');

  // Delete row 4 (Camera 2 - remember row 1 is metadata, row 2 is header, row 3 is Camera 1)
  worksheet2.spliceRows(4, 1);

  await workbook2.xlsx.writeFile('test-2-cameras.xlsx');
  console.log('✓ Created test-2-cameras.xlsx with Camera 1 and 3 (Camera 2 deleted)\n');

  // Step 3: Simulate the import logic
  console.log('Step 3: Simulating import...');

  // Mock existing state (all 3 cameras in app)
  const existingHighlights = {
    'hl-camera-1': { id: 'hl-camera-1', name: 'Camera 1', categoryId: 'cat-1', moduleId: 'mod-1' },
    'hl-camera-2': { id: 'hl-camera-2', name: 'Camera 2', categoryId: 'cat-1', moduleId: 'mod-1' },
    'hl-camera-3': { id: 'hl-camera-3', name: 'Camera 3', categoryId: 'cat-1', moduleId: 'mod-1' }
  };

  console.log('Existing highlights in app:', Object.keys(existingHighlights).map(id => existingHighlights[id].name));

  // Read the Excel file with Camera 2 deleted
  const importWorkbook = XLSX.readFile('test-2-cameras.xlsx');
  const importWorksheet = importWorkbook.Sheets['Test Category - Module'];
  const jsonData = XLSX.utils.sheet_to_json(importWorksheet, { header: 1, defval: '' });

  // Track which highlight IDs are in Excel
  const highlightIdsInExcel = new Set();
  let sheetCategoryId = null;
  let sheetModuleId = null;

  console.log('\nRows in Excel file:');
  for (let i = 2; i < jsonData.length; i++) {
    const row = jsonData[i];
    const itemName = row[2];
    const highlightId = row[6];
    const categoryId = row[7];
    const moduleId = row[8];

    if (!itemName) continue;
    if (!categoryId || !moduleId) continue;

    if (!sheetCategoryId) sheetCategoryId = categoryId;
    if (!sheetModuleId) sheetModuleId = moduleId;

    if (highlightId) {
      highlightIdsInExcel.add(highlightId);
      console.log(`  - ${itemName} (ID: ${highlightId})`);
    }
  }

  console.log('\nHighlight IDs in Excel:', Array.from(highlightIdsInExcel));

  // Apply deletion logic
  const newHighlights = { ...existingHighlights };
  const highlightsToDelete = [];

  Object.entries(newHighlights).forEach(([highlightId, highlight]) => {
    const highlightModuleId = highlight.moduleId;
    const belongsToThisSheet = highlightModuleId === sheetModuleId && highlight.categoryId === sheetCategoryId;

    if (belongsToThisSheet && !highlightIdsInExcel.has(highlightId)) {
      highlightsToDelete.push({ id: highlightId, name: highlight.name });
      delete newHighlights[highlightId];
    }
  });

  console.log('\nDeleted highlights:', highlightsToDelete.map(h => h.name).join(', ') || 'none');

  // Step 4: Verify results
  console.log('\n=== FINAL RESULTS ===');
  console.log('Highlights after import:', Object.keys(newHighlights).map(id => newHighlights[id].name));

  const expectedRemaining = ['Camera 1', 'Camera 3'];
  const actualRemaining = Object.values(newHighlights).map(h => h.name).sort();
  const testPassed = JSON.stringify(actualRemaining) === JSON.stringify(expectedRemaining);

  console.log('\n✅ Expected:', expectedRemaining.join(', '));
  console.log('✅ Actual:', actualRemaining.join(', '));
  console.log('✅ Test', testPassed ? 'PASSED' : 'FAILED');

  if (!testPassed) {
    console.error('\n❌ Test failed! Camera 2 should have been deleted.');
    process.exit(1);
  }
}

testDeletion().catch(console.error);
