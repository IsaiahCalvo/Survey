// Test ExcelJS data validation syntax
const ExcelJS = require('exceljs');

async function testDataValidation() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Test');

  // Add headers
  worksheet.addRow(['Item', 'Status 1', 'Status 2', 'Status 3']);

  // Add some data rows
  worksheet.addRow(['Item 1', 'Y', '', '']);
  worksheet.addRow(['Item 2', '', 'N', '']);
  worksheet.addRow(['Item 3', '', '', 'N/A']);

  // Add empty rows for user input
  worksheet.addRow(['Item 4', '', '', '']);
  worksheet.addRow(['Item 5', '', '', '']);

  // Apply data validation to columns B, C, D (columns 2, 3, 4)
  // For rows 2-6 (after header)
  for (let row = 2; row <= 6; row++) {
    for (let col = 2; col <= 4; col++) {
      const cell = worksheet.getCell(row, col);

      // Apply data validation
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Y,N,N/A"'],
        showErrorMessage: true,
        errorStyle: 'error',
        errorTitle: 'Invalid Selection',
        error: 'Please select Y, N, or N/A'
      };

      // Apply conditional formatting based on value
      const val = cell.value;
      if (val === 'Y') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFCEEED0' }
        };
      } else if (val === 'N') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF6C9CE' }
        };
      } else if (val === 'N/A') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFA6A6A6' }
        };
      }
    }
  }

  // Try different conditional formatting approach - cell by cell
  // Apply to each cell individually for rows 2-10
  for (let col of ['B', 'C', 'D']) {
    worksheet.addConditionalFormatting({
      ref: `${col}2:${col}10`,
      rules: [
        {
          type: 'cellIs',
          operator: 'equal',
          formulae: ['"Y"'],
          style: {
            fill: {
              type: 'pattern',
              pattern: 'solid',
              bgColor: { argb: 'FFCEEED0' }
            }
          },
          priority: 1
        },
        {
          type: 'cellIs',
          operator: 'equal',
          formulae: ['"N"'],
          style: {
            fill: {
              type: 'pattern',
              pattern: 'solid',
              bgColor: { argb: 'FFF6C9CE' }
            }
          },
          priority: 2
        },
        {
          type: 'cellIs',
          operator: 'equal',
          formulae: ['"N/A"'],
          style: {
            fill: {
              type: 'pattern',
              pattern: 'solid',
              bgColor: { argb: 'FFA6A6A6' }
            }
          },
          priority: 3
        }
      ]
    });
  }

  // Save the file
  const buffer = await workbook.xlsx.writeBuffer();
  const fs = require('fs');
  fs.writeFileSync('test-validation.xlsx', buffer);
  console.log('Test file created: test-validation.xlsx');
  console.log('Open it and check if dropdowns appear in columns B, C, D');
}

testDataValidation().catch(console.error);
