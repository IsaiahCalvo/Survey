// Test inserting a row above to check conditional formatting
const ExcelJS = require('exceljs');

async function testInsertAbove() {
  console.log('=== TESTING INSERT ABOVE BEHAVIOR ===\n');

  // Create initial file with 2 items
  console.log('Step 1: Creating Excel with 2 unique items...');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Test');

  // Metadata row
  const metadataRow = worksheet.addRow(['CHANGED_BY_COLUMN', 'CHANGED_DATE_COLUMN', 'METADATA_HEADER']);
  metadataRow.hidden = true;

  // Header row
  worksheet.addRow(['Changed By', 'Changed Date', 'Item']);

  // Data rows (row 3 and 4)
  worksheet.addRow(['User1', '1/1/2025', 'Camera 1']);
  worksheet.addRow(['User2', '1/2/2025', 'Camera 2']);

  // Apply conditional formatting using entire column reference
  const range = 'C3:C1000';
  worksheet.addConditionalFormatting({
    ref: range,
    rules: [
      {
        type: 'expression',
        // Use COUNTIF($C:$C, C3) to search entire column - more robust for insertions
        formulae: ['COUNTIF($C:$C, C3)>1'],
        style: {
          fill: {
            type: 'pattern',
            pattern: 'solid',
            bgColor: { argb: 'FFFFC7CF' }
          },
          font: {
            color: { argb: 'FF9C0006' }
          }
        },
        priority: 1
      }
    ]
  });

  await workbook.xlsx.writeFile('test-before-insert.xlsx');
  console.log('✓ Created test-before-insert.xlsx\n');

  // Now simulate inserting a row above
  console.log('Step 2: Inserting duplicate "Camera 1" above existing Camera 1...');
  const workbook2 = new ExcelJS.Workbook();
  await workbook2.xlsx.readFile('test-before-insert.xlsx');
  const worksheet2 = workbook2.getWorksheet('Test');

  // Insert a new row at position 3 (this pushes existing Camera 1 down to row 4)
  worksheet2.spliceRows(3, 0, ['User3', '1/3/2025', 'Camera 1']);

  await workbook2.xlsx.writeFile('test-after-insert.xlsx');
  console.log('✓ Created test-after-insert.xlsx\n');

  // Read back and check the conditional formatting
  console.log('Step 3: Reading back to examine conditional formatting...');
  const workbook3 = new ExcelJS.Workbook();
  await workbook3.xlsx.readFile('test-after-insert.xlsx');
  const worksheet3 = workbook3.getWorksheet('Test');

  console.log('Rows in file:');
  worksheet3.eachRow((row, rowNumber) => {
    if (rowNumber > 2) {
      const itemValue = row.getCell(3).value;
      console.log(`  Row ${rowNumber}: ${itemValue}`);
    }
  });

  console.log('\nConditional formatting rules:');
  if (worksheet3.conditionalFormattings) {
    worksheet3.conditionalFormattings.forEach((cf, index) => {
      console.log(`  Rule ${index + 1}:`);
      console.log(`    Range: ${cf.ref}`);
      cf.rules.forEach((rule, ruleIndex) => {
        console.log(`    Formula ${ruleIndex + 1}: ${rule.formulae ? rule.formulae[0] : 'N/A'}`);
      });
    });
  }

  console.log('\n=== ANALYSIS ===');
  console.log('Expected: Both Camera 1 items (rows 3 and 4) should be highlighted');
  console.log('The formula COUNTIF($C$3:$C$1000,C3)>1 should:');
  console.log('  - In row 3: Become COUNTIF($C$3:$C$1000,C3)>1');
  console.log('  - In row 4: Become COUNTIF($C$3:$C$1000,C4)>1');
  console.log('\nOpen test-after-insert.xlsx to verify if duplicates are highlighted.');
}

testInsertAbove().catch(console.error);
