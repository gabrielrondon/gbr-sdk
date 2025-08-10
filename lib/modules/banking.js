/**
 * Banking Module - Financial data processing with Brazilian banking standards
 */

const { createModule } = require('../module-system');

// Códigos de bancos brasileiros (Febraban)
const BRAZILIAN_BANKS = {
  '001': 'Banco do Brasil S.A.',
  '003': 'Banco da Amazônia S.A.',
  '104': 'Caixa Econômica Federal',
  '237': 'Banco Bradesco S.A.',
  '341': 'Itaú Unibanco S.A.',
  '033': 'Banco Santander (Brasil) S.A.',
  '745': 'Banco Citibank S.A.',
  '399': 'HSBC Bank Brasil S.A.',
  '655': 'Banco Votorantim S.A.',
  '070': 'BRB - Banco de Brasília S.A.',
  '756': 'Banco Cooperativo do Brasil S.A.',
  '748': 'Banco Cooperativo Sicredi S.A.',
  '136': 'Banco Unicred do Brasil S.A.',
  '077': 'Banco Inter S.A.',
  '260': 'Nu Pagamentos S.A.',
  '323': 'Mercado Pago',
  '290': 'PagSeguro Internet S.A.',
  '364': 'Gerencianet Pagamentos do Brasil'
};

// Validação de conta bancária
function validateBankAccount(bankCode, agency, account) {
  if (!validateBankCode(bankCode)) return { valid: false, error: 'Invalid bank code' };
  if (!validateAgency(agency)) return { valid: false, error: 'Invalid agency' };
  if (!validateAccountNumber(account)) return { valid: false, error: 'Invalid account number' };
  
  return { valid: true };
}

function validateBankCode(bankCode) {
  if (!bankCode) return false;
  const code = bankCode.toString().padStart(3, '0');
  return BRAZILIAN_BANKS.hasOwnProperty(code);
}

function validateAgency(agency) {
  if (!agency) return false;
  const agencyStr = agency.toString().replace(/[^\d]/g, '');
  return /^\d{4,5}$/.test(agencyStr);
}

function validateAccountNumber(account) {
  if (!account) return false;
  const accountStr = account.toString().replace(/[^\d]/g, '');
  return /^\d{5,12}$/.test(accountStr);
}

function validateRoutingNumber(routing) {
  if (!routing) return false;
  return /^\d{8,9}$/.test(routing.toString());
}

// Validação PIX
function validatePIX(pixKey, pixType) {
  if (!pixKey) return false;
  
  switch (pixType?.toLowerCase()) {
    case 'cpf':
      return validateCPF(pixKey);
    case 'cnpj':
      return validateCNPJ(pixKey);
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pixKey);
    case 'phone':
      return /^\+55\d{2}9?\d{8}$/.test(pixKey.replace(/\D/g, ''));
    case 'random':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pixKey);
    default:
      // Auto-detect PIX type
      return validatePIXAutoDetect(pixKey);
  }
}

function validatePIXAutoDetect(pixKey) {
  // Try each PIX type
  if (/^\d{11}$/.test(pixKey) && validateCPF(pixKey)) return true;
  if (/^\d{14}$/.test(pixKey) && validateCNPJ(pixKey)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pixKey)) return true;
  if (/^\+55\d{2}9?\d{8}$/.test(pixKey.replace(/\D/g, ''))) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pixKey)) return true;
  
  return false;
}

// Validação de valores monetários
function validateAmount(amount, options = {}) {
  const { min = 0, max = Infinity, currency = 'BRL' } = options;
  
  if (typeof amount === 'string') {
    // Remove formatação brasileira
    amount = parseFloat(amount.replace(/[^\d,]/g, '').replace(',', '.'));
  }
  
  if (isNaN(amount) || amount < min || amount > max) {
    return { valid: false, error: `Amount must be between ${min} and ${max}` };
  }
  
  return { valid: true, normalized: amount };
}

// Detecção de fraude básica
function detectFraud(transaction) {
  const risks = [];
  const { amount, time, location, account, previous_transactions = [] } = transaction;
  
  // Valores muito altos
  if (amount > 50000) {
    risks.push({ level: 'high', reason: 'High amount transaction', value: amount });
  }
  
  // Transações fora do horário comercial
  const hour = new Date(time).getHours();
  if (hour < 6 || hour > 22) {
    risks.push({ level: 'medium', reason: 'Off-hours transaction', value: hour });
  }
  
  // Múltiplas transações em pouco tempo
  const recentTransactions = previous_transactions.filter(t => 
    new Date(time) - new Date(t.time) < 300000 // 5 minutos
  );
  if (recentTransactions.length > 3) {
    risks.push({ level: 'high', reason: 'Multiple rapid transactions', value: recentTransactions.length });
  }
  
  // Valor muito diferente do padrão
  if (previous_transactions.length > 0) {
    const avgAmount = previous_transactions.reduce((sum, t) => sum + t.amount, 0) / previous_transactions.length;
    if (amount > avgAmount * 10) {
      risks.push({ level: 'medium', reason: 'Unusual amount pattern', value: amount / avgAmount });
    }
  }
  
  const riskLevel = risks.some(r => r.level === 'high') ? 'high' : 
                   risks.some(r => r.level === 'medium') ? 'medium' : 'low';
  
  return {
    riskLevel,
    riskScore: calculateRiskScore(risks),
    risks,
    recommendation: getRiskRecommendation(riskLevel)
  };
}

function calculateRiskScore(risks) {
  return risks.reduce((score, risk) => {
    switch (risk.level) {
      case 'high': return score + 30;
      case 'medium': return score + 15;
      case 'low': return score + 5;
      default: return score;
    }
  }, 0);
}

function getRiskRecommendation(riskLevel) {
  switch (riskLevel) {
    case 'high': return 'BLOCK_TRANSACTION';
    case 'medium': return 'REQUIRE_ADDITIONAL_AUTH';
    case 'low': return 'ALLOW';
    default: return 'ALLOW';
  }
}

// Compliance BACEN
function bacenCompliance(transaction) {
  const compliance = {
    valid: true,
    issues: [],
    requirements: []
  };
  
  const { amount, type, international } = transaction;
  
  // Circular 3461 - Comunicação de movimentação financeira
  if (amount >= 10000) {
    compliance.requirements.push({
      regulation: 'Circular 3461',
      description: 'Comunicação obrigatória ao BACEN para valores >= R$ 10.000',
      action: 'REPORT_TO_BACEN'
    });
  }
  
  // Lei 9613/98 - Prevenção à lavagem de dinheiro
  if (amount >= 50000) {
    compliance.requirements.push({
      regulation: 'Lei 9613/98',
      description: 'Identificação e comunicação de operações suspeitas',
      action: 'ENHANCED_DUE_DILIGENCE'
    });
  }
  
  // Câmbio - Regulamentação internacional
  if (international && amount >= 3000) {
    compliance.requirements.push({
      regulation: 'Resolução CMN 3568',
      description: 'Regulamentação de operações de câmbio',
      action: 'CURRENCY_EXCHANGE_COMPLIANCE'
    });
  }
  
  // Open Banking - Consentimento
  if (type === 'open_banking') {
    compliance.requirements.push({
      regulation: 'Resolução CMN 4658',
      description: 'Consentimento válido para Open Banking',
      action: 'VERIFY_CONSENT'
    });
  }
  
  compliance.valid = compliance.issues.length === 0;
  
  return compliance;
}

// Processador de extratos bancários
const bankStatementProcessor = {
  extensions: ['.ofx', '.qif'],
  description: 'Bank statement processor (OFX/QIF formats)',
  
  async process(filePath, options = {}) {
    console.log(`💳 Processing bank statement: ${filePath}`);
    
    const extension = filePath.split('.').pop().toLowerCase();
    
    if (extension === 'ofx') {
      return this.processOFX(filePath, options);
    } else if (extension === 'qif') {
      return this.processQIF(filePath, options);
    }
    
    throw new Error(`Unsupported bank statement format: ${extension}`);
  },
  
  async processOFX(filePath, options) {
    // Simulação de processamento OFX
    console.log('  📊 Processing OFX format...');
    
    const transactions = [
      {
        line: 1,
        data: {
          date: '2024-01-15',
          amount: -150.00,
          description: 'PAGAMENTO PIX',
          type: 'DEBIT',
          balance: 2850.00
        },
        hash: 'ofx_001'
      },
      {
        line: 2,
        data: {
          date: '2024-01-16',
          amount: 2500.00,
          description: 'SALARIO',
          type: 'CREDIT',
          balance: 5350.00
        },
        hash: 'ofx_002'
      }
    ];
    
    return {
      processed_rows: transactions,
      errors: [],
      format: 'ofx',
      account_info: {
        bank_code: '341',
        bank_name: 'Itaú Unibanco S.A.',
        agency: '1234',
        account: '567890-1'
      }
    };
  },
  
  async processQIF(filePath, options) {
    // Simulação de processamento QIF
    console.log('  📊 Processing QIF format...');
    
    return {
      processed_rows: [],
      errors: [],
      format: 'qif'
    };
  }
};

// Hook para validação de dados bancários
async function validateBankingData(data) {
  if (!data || !data.processed_rows) return data;
  
  console.log('🏦 Banking: Validating financial data...');
  
  const validatedRows = [];
  const bankingErrors = [];
  
  for (const row of data.processed_rows) {
    const rowData = row.data;
    const validations = [];
    
    // Validação de conta bancária
    if (rowData.bank_code || rowData.agency || rowData.account) {
      const accountValidation = validateBankAccount(
        rowData.bank_code,
        rowData.agency,
        rowData.account
      );
      
      if (!accountValidation.valid) {
        validations.push(accountValidation.error);
      }
    }
    
    // Validação PIX
    if (rowData.pix_key) {
      const pixValid = validatePIX(rowData.pix_key, rowData.pix_type);
      if (!pixValid) {
        validations.push('Invalid PIX key');
      }
    }
    
    // Validação de valor
    if (rowData.amount || rowData.value) {
      const amount = rowData.amount || rowData.value;
      const amountValidation = validateAmount(amount);
      
      if (!amountValidation.valid) {
        validations.push(amountValidation.error);
      } else {
        rowData.amount = amountValidation.normalized;
      }
    }
    
    // Detecção de fraude
    if (rowData.amount && rowData.time) {
      const fraudCheck = detectFraud(rowData);
      
      if (fraudCheck.riskLevel === 'high') {
        validations.push(`High fraud risk: ${fraudCheck.riskScore}`);
      }
      
      rowData.fraud_check = fraudCheck;
    }
    
    // Compliance BACEN
    if (rowData.amount) {
      const compliance = bacenCompliance(rowData);
      rowData.bacen_compliance = compliance;
      
      if (!compliance.valid) {
        validations.push('BACEN compliance issues detected');
      }
    }
    
    if (validations.length === 0) {
      validatedRows.push(row);
    } else {
      bankingErrors.push({
        line: row.line,
        error: validations.join(', '),
        raw_data: rowData
      });
    }
  }
  
  return {
    ...data,
    processed_rows: validatedRows,
    errors: [...(data.errors || []), ...bankingErrors],
    banking_summary: {
      total_amount: validatedRows.reduce((sum, row) => sum + (row.data.amount || 0), 0),
      high_risk_transactions: validatedRows.filter(row => 
        row.data.fraud_check?.riskLevel === 'high'
      ).length,
      compliance_issues: validatedRows.filter(row => 
        row.data.bacen_compliance && !row.data.bacen_compliance.valid
      ).length
    }
  };
}

// Comandos CLI bancários
const bankingCommands = {
  'banking:validate-account': {
    description: 'Validate Brazilian bank account',
    handler: async (args) => {
      const { bank, agency, account } = args;
      const result = validateBankAccount(bank, agency, account);
      
      if (result.valid) {
        const bankName = BRAZILIAN_BANKS[bank.padStart(3, '0')] || 'Unknown bank';
        console.log(`✅ Valid account: ${bankName} - ${agency}/${account}`);
      } else {
        console.log(`❌ Invalid account: ${result.error}`);
      }
      
      return result;
    }
  },
  
  'banking:pix-validate': {
    description: 'Validate PIX key',
    handler: async (args) => {
      const { key, type } = args;
      const valid = validatePIX(key, type);
      
      console.log(`PIX Key: ${key} - ${valid ? '✅ Valid' : '❌ Invalid'}`);
      return valid;
    }
  },
  
  'banking:fraud-check': {
    description: 'Check transaction for fraud indicators',
    handler: async (args) => {
      const transaction = {
        amount: parseFloat(args.amount),
        time: args.time || new Date().toISOString(),
        location: args.location || 'Unknown'
      };
      
      const fraudCheck = detectFraud(transaction);
      
      console.log(`Fraud Analysis:`);
      console.log(`  Risk Level: ${fraudCheck.riskLevel}`);
      console.log(`  Risk Score: ${fraudCheck.riskScore}`);
      console.log(`  Recommendation: ${fraudCheck.recommendation}`);
      
      if (fraudCheck.risks.length > 0) {
        console.log(`  Risk Factors:`);
        fraudCheck.risks.forEach(risk => {
          console.log(`    - ${risk.reason} (${risk.level})`);
        });
      }
      
      return fraudCheck;
    }
  },
  
  'banking:list-banks': {
    description: 'List Brazilian banks',
    handler: async () => {
      console.log('🏦 Brazilian Banks (Febraban codes):');
      Object.entries(BRAZILIAN_BANKS).forEach(([code, name]) => {
        console.log(`  ${code} - ${name}`);
      });
      
      return BRAZILIAN_BANKS;
    }
  }
};

// Função de validação CPF (reutilizada do módulo brasileiro)
function validateCPF(cpf) {
  if (!cpf) return false;
  cpf = cpf.replace(/[^\d]/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let digit1 = 11 - (sum % 11);
  if (digit1 > 9) digit1 = 0;
  
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  let digit2 = 11 - (sum % 11);
  if (digit2 > 9) digit2 = 0;
  
  return cpf[9] == digit1 && cpf[10] == digit2;
}

function validateCNPJ(cnpj) {
  if (!cnpj) return false;
  cnpj = cnpj.replace(/[^\d]/g, '');
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  
  let sum = 0, weight = 5;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cnpj[i]) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  let digit1 = 11 - (sum % 11);
  if (digit1 >= 10) digit1 = 0;
  
  sum = 0; weight = 6;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(cnpj[i]) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  let digit2 = 11 - (sum % 11);
  if (digit2 >= 10) digit2 = 0;
  
  return cnpj[12] == digit1 && cnpj[13] == digit2;
}

// Criar e exportar o módulo
const bankingModule = createModule('banking')
  .version('1.0.0')
  .description('Brazilian banking system with account validation, PIX, fraud detection, and BACEN compliance')
  
  // Hooks
  .hook('after:validate', validateBankingData)
  
  // Processadores
  .processor('ofx', bankStatementProcessor)
  .processor('qif', bankStatementProcessor)
  
  // Validadores
  .validator('bank_code', validateBankCode)
  .validator('agency', validateAgency)
  .validator('account_number', validateAccountNumber)
  .validator('pix_key', (value, type) => validatePIX(value, type))
  .validator('amount', (value, options) => validateAmount(value, options).valid)
  
  // Comandos CLI
  .command('banking:validate-account', bankingCommands['banking:validate-account'])
  .command('banking:pix-validate', bankingCommands['banking:pix-validate'])
  .command('banking:fraud-check', bankingCommands['banking:fraud-check'])
  .command('banking:list-banks', bankingCommands['banking:list-banks'])
  
  .build();

// Adicionar utilitários ao módulo
bankingModule.utils = {
  validateBankAccount,
  validateBankCode,
  validateAgency,
  validateAccountNumber,
  validatePIX,
  validateAmount,
  detectFraud,
  bacenCompliance,
  BRAZILIAN_BANKS
};

module.exports = bankingModule;