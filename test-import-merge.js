// Test import merge behavior - simulating the Camera 1 + Camera 2 scenario
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

async function testImportMerge() {
  console.log('=== SIMULATING EXPORT + IMPORT SCENARIO ===\n');

  // Step 1: Create initial export with Camera 1
  console.log('Step 1: Creating initial export with Camera 1...');
  const workbook1 = new ExcelJS.Workbook();
  const worksheet1 = workbook1.addWorksheet('Test Category - Module');

  // Add metadata row (hidden)
  const metadataRow = worksheet1.addRow([
    'CHANGED_BY_COLUMN',
    'CHANGED_DATE_COLUMN',
    'METADATA_HEADER',
    'checklist-1',
    'checklist-2',
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
    'Item 2',
    'Ball in Court',
    'Notes',
    'ID',
    'Category ID',
    'Module ID'
  ]);

  // Add Camera 1 data
  const camera1HighlightId = 'highlight-camera-1-uuid';
  worksheet1.addRow([
    'User1',
    '1/1/2025',
    'Camera 1',
    'Y',
    'N',
    'Contractor',
    'Initial setup',
    camera1HighlightId,
    'category-1',
    'module-1'
  ]);

  await workbook1.xlsx.writeFile('test-export-camera1.xlsx');
  console.log('✓ Created test-export-camera1.xlsx with Camera 1\n');

  // Step 2: User opens Excel and adds Camera 2 by copying Camera 1's row
  console.log('Step 2: Simulating user copying Camera 1 row and changing to Camera 2...');
  const workbook2 = new ExcelJS.Workbook();
  await workbook2.xlsx.readFile('test-export-camera1.xlsx');
  const worksheet2 = workbook2.getWorksheet('Test Category - Module');

  // Add Camera 2 by copying Camera 1's row (this is what user does in Excel)
  // Note: The highlight ID will still be Camera 1's ID - this is the bug scenario
  worksheet2.addRow([
    'User2',
    '1/2/2025',
    'Camera 2',  // User changed the name
    'N',
    'Y',
    'Owner',
    'Second camera',
    camera1HighlightId,  // PROBLEM: Still has Camera 1's ID!
    'category-1',
    'module-1'
  ]);

  await workbook2.xlsx.writeFile('test-export-camera1-and-2.xlsx');
  console.log('✓ Created test-export-camera1-and-2.xlsx with Camera 1 AND Camera 2\n');

  // Step 3: Read the file with XLSX library (simulating import)
  console.log('Step 3: Reading Excel file with XLSX library (simulating import)...');
  const importWorkbook = XLSX.readFile('test-export-camera1-and-2.xlsx');
  const importWorksheet = importWorkbook.Sheets['Test Category - Module'];
  const jsonData = XLSX.utils.sheet_to_json(importWorksheet, { header: 1, defval: '' });

  console.log('Imported data:');
  jsonData.forEach((row, index) => {
    if (index < 3) {
      console.log(`  Row ${index}:`, row);
    } else {
      const itemName = row[2];
      const highlightId = row[7];
      console.log(`  Row ${index}: Item="${itemName}", HighlightID="${highlightId}"`);
    }
  });

  // Step 4: Simulate the import logic
  console.log('\nStep 4: Simulating import logic...');

  // Mock existing state (Camera 1 already in app)
  const existingHighlights = {
    [camera1HighlightId]: {
      id: camera1HighlightId,
      name: 'Camera 1',
      categoryId: 'category-1',
      moduleId: 'module-1',
      checklistResponses: {
        'checklist-1': { selection: 'Y' },
        'checklist-2': { selection: 'N' }
      }
    }
  };

  const newHighlights = { ...existingHighlights };

  // Process each row
  for (let i = 2; i < jsonData.length; i++) {
    const row = jsonData[i];
    const itemName = row[2];
    const highlightId = row[7];

    console.log(`\nProcessing row ${i}: "${itemName}" with ID "${highlightId}"`);

    const hasHighlight = highlightId && newHighlights[highlightId];
    const isNameMismatch = hasHighlight && newHighlights[highlightId].name !== itemName;

    console.log(`  - hasHighlight: ${hasHighlight}`);
    console.log(`  - isNameMismatch: ${isNameMismatch}`);

    if (hasHighlight && !isNameMismatch) {
      console.log(`  → Updating existing highlight: ${highlightId}`);
      newHighlights[highlightId] = {
        ...newHighlights[highlightId],
        name: itemName
      };
    } else {
      console.log(`  → Creating NEW highlight for "${itemName}"`);

      let newHighlightId;

      if (isNameMismatch) {
        // Check if highlight already exists for this name
        const existingForName = Object.entries(newHighlights).find(([id, hl]) =>
          hl.name === itemName && hl.categoryId === 'category-1' && hl.moduleId === 'module-1'
        );

        if (existingForName) {
          newHighlightId = existingForName[0];
          console.log(`  → Found existing highlight for "${itemName}": ${newHighlightId}`);
        } else {
          newHighlightId = `new-highlight-${itemName.toLowerCase().replace(/\s+/g, '-')}`;
          console.log(`  → Generated new UUID: ${newHighlightId}`);
        }
      } else {
        newHighlightId = highlightId || `new-highlight-${itemName.toLowerCase().replace(/\s+/g, '-')}`;
      }

      newHighlights[newHighlightId] = {
        id: newHighlightId,
        name: itemName,
        categoryId: 'category-1',
        moduleId: 'module-1',
        checklistResponses: {
          'checklist-1': { selection: row[3] },
          'checklist-2': { selection: row[4] }
        }
      };
    }
  }

  // Step 5: Verify results
  console.log('\n=== FINAL RESULTS ===');
  console.log('Highlights after import:');
  Object.entries(newHighlights).forEach(([id, hl]) => {
    console.log(`  - ${hl.name} (ID: ${id})`);
  });

  console.log('\n✅ Expected: Both "Camera 1" and "Camera 2" should exist');
  console.log('✅ Test', Object.keys(newHighlights).length === 2 ? 'PASSED' : 'FAILED');
}

testImportMerge().catch(console.error);
