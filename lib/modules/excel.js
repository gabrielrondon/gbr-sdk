/**
 * Excel Module - Processador de arquivos Excel/XLSX
 */

const { createModule } = require('../module-system');

// Simulação de processamento Excel (na prática usaria uma biblioteca como 'xlsx')
const excelProcessor = {
  extensions: ['.xlsx', '.xls', '.xlsm'],
  description: 'Excel and OpenOffice Calc processor',
  
  async process(filePath, options = {}) {
    console.log(`📊 Processing Excel file: ${filePath}`);
    
    try {
      // Na implementação real, usaria:
      // const XLSX = require('xlsx');
      // const workbook = XLSX.readFile(filePath);
      
      // Simulação de processamento
      const workbook = await this.readExcelFile(filePath);
      const processed_rows = [];
      const errors = [];
      
      // Processa cada planilha
      for (const sheetName of Object.keys(workbook.sheets)) {
        const sheet = workbook.sheets[sheetName];
        
        // Opção para processar apenas planilhas específicas
        if (options.sheets && !options.sheets.includes(sheetName)) {
          continue;
        }
        
        console.log(`  📄 Processing sheet: ${sheetName}`);
        
        const sheetData = this.sheetToJSON(sheet, options);
        
        for (let i = 0; i < sheetData.length; i++) {
          const row = sheetData[i];
          
          // Validação básica
          const validation = await this.validateExcelRow(row, i + 2, sheetName);
          
          if (validation.valid) {
            processed_rows.push({
              line: i + 2,
              sheet: sheetName,
              data: row,
              hash: this.generateHash(JSON.stringify(row))
            });
          } else {
            errors.push({
              line: i + 2,
              sheet: sheetName,
              error: validation.error,
              raw_data: row
            });
          }
        }
      }
      
      return {
        processed_rows,
        errors,
        format: 'excel',
        sheets: Object.keys(workbook.sheets)
      };
      
    } catch (error) {
      throw new Error(`Excel processing failed: ${error.message}`);
    }
  },
  
  async readExcelFile(filePath) {
    // Simulação - na prática usaria XLSX.readFile(filePath)
    return {
      sheets: {
        'Sheet1': {
          '!ref': 'A1:D10',
          'A1': { v: 'Nome' },
          'B1': { v: 'Email' },
          'C1': { v: 'Idade' },
          'D1': { v: 'Cidade' },
          'A2': { v: 'João Silva' },
          'B2': { v: 'joao@email.com' },
          'C2': { v: 30 },
          'D2': { v: 'São Paulo' }
          // ... mais dados simulados
        }
      }
    };
  },
  
  sheetToJSON(sheet, options = {}) {
    // Simulação de conversão sheet para JSON
    // Na prática usaria XLSX.utils.sheet_to_json(sheet, options)
    return [
      {
        'Nome': 'João Silva',
        'Email': 'joao@email.com',
        'Idade': 30,
        'Cidade': 'São Paulo'
      },
      {
        'Nome': 'Maria Santos',
        'Email': 'maria@email.com',
        'Idade': 25,
        'Cidade': 'Rio de Janeiro'
      }
      // ... mais dados simulados
    ];
  },
  
  async validateExcelRow(row, lineNumber, sheetName) {
    // Validação específica para Excel
    if (!row || typeof row !== 'object') {
      return {
        valid: false,
        error: 'Invalid row data'
      };
    }
    
    // Verifica se há campos vazios
    const emptyFields = Object.entries(row)
      .filter(([key, value]) => !value || value.toString().trim() === '')
      .map(([key]) => key);
    
    if (emptyFields.length > 0) {
      return {
        valid: false,
        error: `Empty fields: ${emptyFields.join(', ')}`
      };
    }
    
    return { valid: true };
  },
  
  generateHash(content) {
    // Simulação de hash - na prática usaria crypto
    const hash = Buffer.from(content).toString('base64').substring(0, 16);
    return `excel_${hash}`;
  }
};

// Hook para pré-processamento de dados Excel
async function preprocessExcelData(data) {
  if (!data || !data.format || data.format !== 'excel') {
    return data;
  }
  
  console.log(`📊 Excel preprocessing: ${data.processed_rows.length} rows`);
  
  // Limpa espaços em branco extras
  data.processed_rows.forEach(row => {
    if (row.data && typeof row.data === 'object') {
      Object.keys(row.data).forEach(key => {
        if (typeof row.data[key] === 'string') {
          row.data[key] = row.data[key].trim();
        }
      });
    }
  });
  
  return data;
}

// Hook para converter tipos de dados Excel
async function convertExcelTypes(data) {
  if (!data || !data.format || data.format !== 'excel') {
    return data;
  }
  
  console.log('🔄 Converting Excel data types...');
  
  data.processed_rows.forEach(row => {
    if (row.data && typeof row.data === 'object') {
      Object.keys(row.data).forEach(key => {
        const value = row.data[key];
        
        // Converte datas do Excel
        if (this.isExcelDate(value)) {
          row.data[key] = this.excelDateToJS(value);
        }
        
        // Converte números
        if (typeof value === 'string' && /^\d+\.?\d*$/.test(value)) {
          row.data[key] = parseFloat(value);
        }
        
        // Converte booleanos
        if (typeof value === 'string') {
          const lower = value.toLowerCase();
          if (lower === 'true' || lower === 'verdadeiro' || lower === 'sim') {
            row.data[key] = true;
          } else if (lower === 'false' || lower === 'falso' || lower === 'não') {
            row.data[key] = false;
          }
        }
      });
    }
  });
  
  return data;
}

// Utilitários para Excel
const excelUtils = {
  isExcelDate(value) {
    // Detecta se valor é uma data do Excel
    return typeof value === 'number' && value > 25569 && value < 2958465;
  },
  
  excelDateToJS(excelDate) {
    // Converte data do Excel para JavaScript
    const date = new Date((excelDate - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  },
  
  getColumnName(columnIndex) {
    // Converte índice para nome da coluna (A, B, C, ..., AA, AB)
    let result = '';
    while (columnIndex >= 0) {
      result = String.fromCharCode(65 + (columnIndex % 26)) + result;
      columnIndex = Math.floor(columnIndex / 26) - 1;
    }
    return result;
  },
  
  parseRange(range) {
    // Parse range like "A1:D10"
    const [start, end] = range.split(':');
    return { start, end };
  }
};

// Comandos CLI para Excel
const excelCommands = {
  'excel:sheets': {
    description: 'List sheets in Excel file',
    handler: async (args) => {
      const { file } = args;
      if (!file) {
        console.error('❌ File path required');
        return;
      }
      
      try {
        const workbook = await excelProcessor.readExcelFile(file);
        const sheets = Object.keys(workbook.sheets);
        
        console.log(`📊 Sheets in ${file}:`);
        sheets.forEach((sheet, index) => {
          console.log(`  ${index + 1}. ${sheet}`);
        });
        
        return sheets;
      } catch (error) {
        console.error('❌ Error reading Excel file:', error.message);
      }
    }
  },
  
  'excel:convert': {
    description: 'Convert Excel to CSV',
    handler: async (args) => {
      const { input, output, sheet } = args;
      if (!input || !output) {
        console.error('❌ Input and output paths required');
        return;
      }
      
      console.log(`🔄 Converting ${input} to ${output}`);
      if (sheet) {
        console.log(`📄 Processing sheet: ${sheet}`);
      }
      
      // Implementação da conversão seria aqui
      console.log('✅ Conversion completed');
    }
  }
};

// Criar e exportar o módulo
const excelModule = createModule('excel')
  .version('1.0.0')
  .description('Excel/XLSX processor with multi-sheet support and data type conversion')
  
  // Hooks
  .hook('after:process', preprocessExcelData)
  .hook('after:process', convertExcelTypes)
  
  // Processador
  .processor('xlsx', excelProcessor)
  .processor('xls', excelProcessor)
  .processor('xlsm', excelProcessor)
  
  // Comandos CLI
  .command('excel:sheets', excelCommands['excel:sheets'])
  .command('excel:convert', excelCommands['excel:convert'])
  
  .build();

// Adicionar utilitários ao módulo
excelModule.utils = excelUtils;

module.exports = excelModule;