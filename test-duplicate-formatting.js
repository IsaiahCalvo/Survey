// Test duplicate item formatting in Excel export
const ExcelJS = require('exceljs');

async function testDuplicateFormatting() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Test Sheet');

  // Add headers (matching the actual structure)
  worksheet.addRow(['CHANGED_BY_COLUMN', 'CHANGED_DATE_COLUMN', 'METADATA_HEADER', 'Item1_ID']).hidden = true;
  worksheet.addRow(['Changed By', 'Changed Date', 'Item', 'Status 1']);

  // Add test data with some duplicates
  worksheet.addRow(['User1', '1/1/2025', 'Item A', 'Y']);
  worksheet.addRow(['User2', '1/2/2025', 'Item B', 'N']);
  worksheet.addRow(['User3', '1/3/2025', 'Item A', 'N/A']); // Duplicate
  worksheet.addRow(['User4', '1/4/2025', 'Item C', 'Y']);
  worksheet.addRow(['User5', '1/5/2025', 'Item B', 'N']); // Duplicate
  worksheet.addRow(['User6', '1/6/2025', 'Item D', 'Y']);
  worksheet.addRow(['User7', '1/7/2025', 'Item A', 'Y']); // Duplicate

  // Apply dynamic duplicate detection using COUNTIF formula
  const itemColumnLetter = 'C';
  const headerRowIndex = 2;
  const lastRow = 1000; // Apply to a large range to cover future additions

  // Apply conditional formatting to the entire Item column range
  const range = `${itemColumnLetter}${headerRowIndex + 1}:${itemColumnLetter}${lastRow}`;

  worksheet.addConditionalFormatting({
    ref: range,
    rules: [
      {
        type: 'expression',
        // Formula checks if the current cell appears more than once in the column
        formulae: [`COUNTIF($${itemColumnLetter}$${headerRowIndex + 1}:$${itemColumnLetter}$${lastRow}, ${itemColumnLetter}${headerRowIndex + 1})>1`],
        style: {
          fill: {
            type: 'pattern',
            pattern: 'solid',
            bgColor: { argb: 'FFFFC7CF' } // Light Red Fill
          },
          font: {
            color: { argb: 'FF9C0006' } // Dark Red Text
          }
        },
        priority: 1
      }
    ]
  });

  console.log(`Applied dynamic duplicate formatting to range ${range}`);

  // Save the file
  const buffer = await workbook.xlsx.writeBuffer();
  const fs = require('fs');
  fs.writeFileSync('test-duplicate-formatting.xlsx', buffer);
  console.log('\nTest file created: test-duplicate-formatting.xlsx');
  console.log('Expected: Items "Item A" and "Item B" should be highlighted in red');
}

testDuplicateFormatting().catch(console.error);
