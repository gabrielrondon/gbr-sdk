/**
 * Brazilian Module - Validadores e processadores específicos para o Brasil
 */

const { createModule } = require('../module-system');

// Utilitários brasileiros
function validateCPF(cpf) {
  if (!cpf) return false;
  
  // Remove formatação
  cpf = cpf.replace(/[^\d]/g, '');
  
  // Verifica se tem 11 dígitos
  if (cpf.length !== 11) return false;
  
  // Verifica se não são todos números iguais
  if (/^(\d)\1+$/.test(cpf)) return false;
  
  // Valida dígitos verificadores
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cpf[i]) * (10 - i);
  }
  let digit1 = 11 - (sum % 11);
  if (digit1 > 9) digit1 = 0;
  
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cpf[i]) * (11 - i);
  }
  let digit2 = 11 - (sum % 11);
  if (digit2 > 9) digit2 = 0;
  
  return cpf[9] == digit1 && cpf[10] == digit2;
}

function validateCNPJ(cnpj) {
  if (!cnpj) return false;
  
  cnpj = cnpj.replace(/[^\d]/g, '');
  
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1+$/.test(cnpj)) return false;
  
  // Valida primeiro dígito verificador
  let sum = 0;
  let weight = 5;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cnpj[i]) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  let digit1 = 11 - (sum % 11);
  if (digit1 >= 10) digit1 = 0;
  
  // Valida segundo dígito verificador
  sum = 0;
  weight = 6;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(cnpj[i]) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  let digit2 = 11 - (sum % 11);
  if (digit2 >= 10) digit2 = 0;
  
  return cnpj[12] == digit1 && cnpj[13] == digit2;
}

function validateCEP(cep) {
  if (!cep) return false;
  cep = cep.replace(/[^\d]/g, '');
  return /^\d{8}$/.test(cep);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

function cleanCurrency(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    return parseFloat(value.replace(/[^\d,]/g, '').replace(',', '.'));
  }
  return 0;
}

// Estados brasileiros
const BRAZILIAN_STATES = {
  'AC': 'Acre',
  'AL': 'Alagoas', 
  'AP': 'Amapá',
  'AM': 'Amazonas',
  'BA': 'Bahia',
  'CE': 'Ceará',
  'DF': 'Distrito Federal',
  'ES': 'Espírito Santo',
  'GO': 'Goiás',
  'MA': 'Maranhão',
  'MT': 'Mato Grosso',
  'MS': 'Mato Grosso do Sul',
  'MG': 'Minas Gerais',
  'PA': 'Pará',
  'PB': 'Paraíba',
  'PR': 'Paraná',
  'PE': 'Pernambuco',
  'PI': 'Piauí',
  'RJ': 'Rio de Janeiro',
  'RN': 'Rio Grande do Norte',
  'RS': 'Rio Grande do Sul',
  'RO': 'Rondônia',
  'RR': 'Roraima',
  'SC': 'Santa Catarina',
  'SP': 'São Paulo',
  'SE': 'Sergipe',
  'TO': 'Tocantins'
};

function validateState(state) {
  if (!state) return false;
  return BRAZILIAN_STATES.hasOwnProperty(state.toUpperCase());
}

// Hook para sanitizar dados brasileiros
async function sanitizeBrazilianData(data) {
  if (!data || typeof data !== 'object') return data;
  
  const result = { ...data };
  
  // Sanitiza CPF/CNPJ
  if (result.cpf) {
    result.cpf = result.cpf.replace(/[^\d]/g, '');
  }
  if (result.cnpj) {
    result.cnpj = result.cnpj.replace(/[^\d]/g, '');
  }
  
  // Sanitiza CEP
  if (result.cep) {
    result.cep = result.cep.replace(/[^\d]/g, '');
  }
  
  // Sanitiza telefone
  if (result.telefone || result.phone) {
    const field = result.telefone ? 'telefone' : 'phone';
    result[field] = result[field].replace(/[^\d]/g, '');
  }
  
  // Padroniza valores monetários
  if (result.valor || result.price || result.preco) {
    const field = result.valor ? 'valor' : (result.price ? 'price' : 'preco');
    result[field] = cleanCurrency(result[field]);
  }
  
  return result;
}

// Hook de validação LGPD
async function lgpdValidation(data) {
  if (!data) return data;
  
  const sensitiveFields = ['cpf', 'cnpj', 'rg', 'email', 'telefone', 'endereco'];
  const warnings = [];
  
  for (const field of sensitiveFields) {
    if (data[field]) {
      warnings.push(`Campo sensível detectado: ${field} (LGPD)`);
    }
  }
  
  if (warnings.length > 0) {
    console.warn('⚠️ LGPD:', warnings.join(', '));
  }
  
  return data;
}

// Processador para NFe (Nota Fiscal eletrônica)
const nfeProcessor = {
  extensions: ['.xml'],
  description: 'Processador de Notas Fiscais eletrônicas',
  
  async process(content) {
    // Simula processamento de NFe
    const lines = content.split('\n');
    const processed = [];
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('<infNFe')) {
        const nfeData = {
          line: i + 1,
          tipo: 'NFe',
          numero: extractXMLValue(lines[i], 'nNF'),
          serie: extractXMLValue(lines[i], 'serie'),
          data: extractXMLValue(lines[i], 'dhEmi')
        };
        
        processed.push(nfeData);
      }
    }
    
    return {
      processed_rows: processed,
      errors: [],
      format: 'nfe-xml'
    };
  }
};

function extractXMLValue(xml, tag) {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`);
  const match = xml.match(regex);
  return match ? match[1] : '';
}

// Comando CLI para validar dados brasileiros
const brazilianCommands = {
  'br:validate': {
    description: 'Validate Brazilian documents (CPF, CNPJ, CEP)',
    handler: async (args) => {
      const { value, type } = args;
      
      let result = false;
      switch (type) {
        case 'cpf':
          result = validateCPF(value);
          break;
        case 'cnpj':
          result = validateCNPJ(value);
          break;
        case 'cep':
          result = validateCEP(value);
          break;
        case 'state':
          result = validateState(value);
          break;
      }
      
      console.log(`${type.toUpperCase()}: ${value} - ${result ? '✅ Válido' : '❌ Inválido'}`);
      return result;
    }
  },
  
  'br:format': {
    description: 'Format Brazilian values',
    handler: async (args) => {
      const { value, type } = args;
      
      switch (type) {
        case 'currency':
          console.log(formatCurrency(value));
          break;
        case 'cpf':
          const cpf = value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
          console.log(cpf);
          break;
        case 'cnpj':
          const cnpj = value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
          console.log(cnpj);
          break;
      }
    }
  }
};

// Criar e exportar o módulo
const brazilianModule = createModule('brazilian')
  .version('1.0.0')
  .description('Brazilian validators and processors for CPF, CNPJ, CEP, NFe, LGPD compliance')
  
  // Hooks
  .hook('before:process', sanitizeBrazilianData)
  .hook('after:validate', lgpdValidation)
  
  // Processadores
  .processor('nfe', nfeProcessor)
  
  // Validadores
  .validator('cpf', validateCPF)
  .validator('cnpj', validateCNPJ)
  .validator('cep', validateCEP)
  .validator('state', validateState)
  
  // Comandos CLI
  .command('br:validate', brazilianCommands['br:validate'])
  .command('br:format', brazilianCommands['br:format'])
  
  .build();

// Adicionar utilitários ao módulo
brazilianModule.utils = {
  validateCPF,
  validateCNPJ,
  validateCEP,
  validateState,
  formatCurrency,
  cleanCurrency,
  BRAZILIAN_STATES
};

module.exports = brazilianModule;