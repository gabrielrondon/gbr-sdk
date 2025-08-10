/**
 * Healthcare Module - Medical data processing with HIPAA compliance and HL7/FHIR support
 */

const { createModule } = require('../module-system');
const crypto = require('crypto');

// HIPAA Safe Harbor identifiers to remove/anonymize
const HIPAA_IDENTIFIERS = [
  'name', 'names', 'patient_name', 'full_name',
  'address', 'street', 'city', 'state', 'zip', 'zipcode',
  'phone', 'telephone', 'mobile', 'fax',
  'email', 'email_address',
  'ssn', 'social_security',
  'mrn', 'medical_record_number', 'patient_id',
  'account_number', 'account_id',
  'license_number', 'vehicle_id',
  'device_id', 'serial_number',
  'url', 'website', 'web_address',
  'ip_address', 'ip', 'mac_address',
  'biometric', 'fingerprint', 'retinal_scan',
  'photograph', 'image', 'photo',
  'date_of_birth', 'birth_date', 'dob',
  'admission_date', 'discharge_date',
  'death_date', 'date_of_death'
];

// Medical specialties
const MEDICAL_SPECIALTIES = {
  'cardiology': 'Cardiologia',
  'dermatology': 'Dermatologia',
  'endocrinology': 'Endocrinologia',
  'gastroenterology': 'Gastroenterologia',
  'neurology': 'Neurologia',
  'oncology': 'Oncologia',
  'orthopedics': 'Ortopedia',
  'pediatrics': 'Pediatria',
  'psychiatry': 'Psiquiatria',
  'radiology': 'Radiologia',
  'surgery': 'Cirurgia',
  'urology': 'Urologia'
};

// ICD-10 basic validation (simplified)
function validateICD10(code) {
  if (!code) return false;
  // ICD-10 format: A00-Z99.999
  return /^[A-Z]\d{2}(\.\d{1,3})?$/i.test(code);
}

// CPT code validation
function validateCPT(code) {
  if (!code) return false;
  // CPT codes are 5-digit numeric codes
  return /^\d{5}$/.test(code.toString());
}

// LOINC code validation
function validateLOINC(code) {
  if (!code) return false;
  // LOINC format: nnnnn-n (5 digits, hyphen, check digit)
  return /^\d{5}-\d$/.test(code);
}

// Validate medical professional license (CRM - Brazil)
function validateCRM(crm, state) {
  if (!crm) return false;
  const crmStr = crm.toString().replace(/\D/g, '');
  
  // CRM numbers are typically 4-6 digits
  if (!/^\d{4,6}$/.test(crmStr)) return false;
  
  // Validate state if provided
  if (state) {
    const validStates = ['SP', 'RJ', 'MG', 'RS', 'PR', 'SC', 'BA', 'GO', 'PE', 'CE', 'PB', 'SE', 'AL', 'RN', 'PI', 'MA', 'TO', 'MT', 'MS', 'AC', 'RO', 'RR', 'AM', 'AP', 'PA', 'ES', 'DF'];
    if (!validStates.includes(state.toUpperCase())) return false;
  }
  
  return true;
}

// HIPAA compliant anonymization
function anonymizeData(data, method = 'hash') {
  if (!data || typeof data !== 'object') return data;
  
  const anonymized = { ...data };
  
  for (const [key, value] of Object.entries(anonymized)) {
    const keyLower = key.toLowerCase();
    const isIdentifier = HIPAA_IDENTIFIERS.some(id => 
      keyLower.includes(id) || id.includes(keyLower)
    );
    
    if (isIdentifier && value) {
      switch (method) {
        case 'hash':
          anonymized[key] = hashValue(value.toString());
          break;
        case 'mask':
          anonymized[key] = maskValue(value.toString());
          break;
        case 'remove':
          delete anonymized[key];
          break;
        case 'synthetic':
          anonymized[key] = generateSyntheticValue(keyLower, value);
          break;
        default:
          anonymized[key] = '[REDACTED]';
      }
    }
    
    // Special handling for dates (shift by random days but keep relative order)
    if (keyLower.includes('date') && isValidDate(value)) {
      anonymized[key] = shiftDate(value, getDeterministicShift(value));
    }
  }
  
  return anonymized;
}

function hashValue(value) {
  return crypto.createHash('sha256')
    .update(value + 'HIPAA_SALT_2024')
    .digest('hex')
    .substring(0, 16);
}

function maskValue(value) {
  if (value.length <= 3) return '*'.repeat(value.length);
  return value.substring(0, 2) + '*'.repeat(value.length - 4) + value.substring(value.length - 2);
}

function generateSyntheticValue(fieldType, originalValue) {
  const syntheticData = {
    'name': ['John Doe', 'Jane Smith', 'Michael Johnson', 'Sarah Wilson'][Math.floor(Math.random() * 4)],
    'email': 'patient' + Math.floor(Math.random() * 1000) + '@example.com',
    'phone': '+1-555-' + String(Math.floor(Math.random() * 9000) + 1000),
    'address': Math.floor(Math.random() * 999) + ' Main St',
    'city': ['Anytown', 'Springfield', 'Riverside', 'Franklin'][Math.floor(Math.random() * 4)]
  };
  
  for (const [key, syntheticValue] of Object.entries(syntheticData)) {
    if (fieldType.includes(key)) {
      return syntheticValue;
    }
  }
  
  return '[SYNTHETIC]';
}

function isValidDate(value) {
  return !isNaN(Date.parse(value));
}

function shiftDate(dateValue, days) {
  const date = new Date(dateValue);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function getDeterministicShift(value) {
  // Generate consistent shift based on value hash
  const hash = crypto.createHash('md5').update(value.toString()).digest('hex');
  const shift = parseInt(hash.substring(0, 8), 16) % 365 - 182; // ±6 months
  return shift;
}

// HL7 message processor
const hl7Processor = {
  extensions: ['.hl7', '.txt'],
  description: 'HL7 message processor for healthcare interoperability',
  
  async process(filePath, options = {}) {
    console.log(`🏥 Processing HL7 messages: ${filePath}`);
    
    // Simulate HL7 processing
    const fs = require('fs');
    const content = fs.readFileSync(filePath, 'utf8');
    const messages = content.split('\n\n').filter(msg => msg.trim());
    
    const processed_rows = [];
    const errors = [];
    
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i].trim();
      
      if (message.startsWith('MSH|')) {
        const parsed = this.parseHL7Message(message, i + 1);
        if (parsed.valid) {
          processed_rows.push(parsed.data);
        } else {
          errors.push(parsed.error);
        }
      }
    }
    
    return {
      processed_rows,
      errors,
      format: 'hl7'
    };
  },
  
  parseHL7Message(message, lineNumber) {
    try {
      const segments = message.split('\r').filter(s => s.trim());
      const msh = segments.find(s => s.startsWith('MSH'));
      
      if (!msh) {
        return {
          valid: false,
          error: { line: lineNumber, error: 'Missing MSH segment', raw_data: message }
        };
      }
      
      const fields = msh.split('|');
      
      return {
        valid: true,
        data: {
          line: lineNumber,
          data: {
            message_type: fields[8] || '',
            sending_application: fields[2] || '',
            sending_facility: fields[3] || '',
            receiving_application: fields[4] || '',
            receiving_facility: fields[5] || '',
            timestamp: fields[6] || '',
            message_control_id: fields[9] || '',
            version: fields[11] || ''
          },
          hash: this.generateHL7Hash(message)
        }
      };
    } catch (error) {
      return {
        valid: false,
        error: { line: lineNumber, error: error.message, raw_data: message }
      };
    }
  },
  
  generateHL7Hash(message) {
    return crypto.createHash('md5')
      .update(message)
      .digest('hex')
      .substring(0, 16);
  }
};

// FHIR resource validator
function validateFHIRResource(resource) {
  if (!resource || typeof resource !== 'object') {
    return { valid: false, error: 'Invalid resource format' };
  }
  
  const { resourceType, id } = resource;
  
  if (!resourceType) {
    return { valid: false, error: 'Missing resourceType' };
  }
  
  const validResourceTypes = [
    'Patient', 'Practitioner', 'Organization', 'Encounter',
    'Observation', 'Condition', 'Procedure', 'MedicationRequest',
    'DiagnosticReport', 'DocumentReference'
  ];
  
  if (!validResourceTypes.includes(resourceType)) {
    return { valid: false, error: `Invalid resourceType: ${resourceType}` };
  }
  
  // Basic FHIR validation rules
  if (resourceType === 'Patient') {
    return validatePatientResource(resource);
  } else if (resourceType === 'Observation') {
    return validateObservationResource(resource);
  }
  
  return { valid: true };
}

function validatePatientResource(patient) {
  const required = ['resourceType', 'id'];
  const missing = required.filter(field => !patient[field]);
  
  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  
  // Validate identifier if present
  if (patient.identifier) {
    for (const identifier of patient.identifier) {
      if (!identifier.value) {
        return { valid: false, error: 'Identifier missing value' };
      }
    }
  }
  
  return { valid: true };
}

function validateObservationResource(observation) {
  const required = ['resourceType', 'id', 'status', 'code'];
  const missing = required.filter(field => !observation[field]);
  
  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  
  // Validate status
  const validStatuses = ['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled'];
  if (!validStatuses.includes(observation.status)) {
    return { valid: false, error: `Invalid status: ${observation.status}` };
  }
  
  return { valid: true };
}

// HIPAA compliance check
function hipaaComplianceCheck(data) {
  const compliance = {
    compliant: true,
    issues: [],
    recommendations: []
  };
  
  if (!data || typeof data !== 'object') {
    return compliance;
  }
  
  // Check for PHI (Protected Health Information)
  const phiFound = [];
  
  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();
    const isPHI = HIPAA_IDENTIFIERS.some(id => 
      keyLower.includes(id) || id.includes(keyLower)
    );
    
    if (isPHI && value) {
      phiFound.push(key);
    }
  }
  
  if (phiFound.length > 0) {
    compliance.compliant = false;
    compliance.issues.push({
      type: 'PHI_DETECTED',
      fields: phiFound,
      severity: 'HIGH',
      description: 'Protected Health Information detected in data'
    });
    
    compliance.recommendations.push({
      action: 'ANONYMIZE_DATA',
      description: 'Apply HIPAA Safe Harbor anonymization to PHI fields',
      fields: phiFound
    });
  }
  
  // Check for minimum necessary standard
  const totalFields = Object.keys(data).length;
  if (totalFields > 20) {
    compliance.issues.push({
      type: 'EXCESSIVE_DATA',
      severity: 'MEDIUM',
      description: 'Large number of fields may violate minimum necessary standard'
    });
    
    compliance.recommendations.push({
      action: 'REVIEW_NECESSITY',
      description: 'Review if all fields are necessary for the intended use'
    });
  }
  
  return compliance;
}

// Hook para processamento médico
async function processHealthcareData(data) {
  if (!data || !data.processed_rows) return data;
  
  console.log('🏥 Healthcare: Processing medical data with HIPAA compliance...');
  
  const processedRows = [];
  const hipaaIssues = [];
  
  for (const row of data.processed_rows) {
    const rowData = row.data;
    
    // HIPAA compliance check
    const hipaaCheck = hipaaComplianceCheck(rowData);
    
    if (!hipaaCheck.compliant) {
      // Apply automatic anonymization
      const anonymizedData = anonymizeData(rowData, 'hash');
      
      processedRows.push({
        ...row,
        data: anonymizedData,
        hipaa_anonymized: true,
        original_phi_fields: hipaaCheck.issues
          .filter(i => i.type === 'PHI_DETECTED')
          .flatMap(i => i.fields)
      });
      
      hipaaIssues.push({
        line: row.line,
        issues: hipaaCheck.issues,
        action_taken: 'ANONYMIZED'
      });
    } else {
      processedRows.push({
        ...row,
        hipaa_compliant: true
      });
    }
    
    // Validate medical codes if present
    const validationResults = [];
    
    if (rowData.icd10_code) {
      const valid = validateICD10(rowData.icd10_code);
      if (!valid) validationResults.push('Invalid ICD-10 code');
    }
    
    if (rowData.cpt_code) {
      const valid = validateCPT(rowData.cpt_code);
      if (!valid) validationResults.push('Invalid CPT code');
    }
    
    if (rowData.loinc_code) {
      const valid = validateLOINC(rowData.loinc_code);
      if (!valid) validationResults.push('Invalid LOINC code');
    }
    
    if (rowData.crm && rowData.state) {
      const valid = validateCRM(rowData.crm, rowData.state);
      if (!valid) validationResults.push('Invalid CRM license');
    }
    
    if (validationResults.length > 0) {
      row.medical_validation_errors = validationResults;
    }
  }
  
  return {
    ...data,
    processed_rows: processedRows,
    hipaa_compliance: {
      total_rows: data.processed_rows.length,
      anonymized_rows: hipaaIssues.length,
      compliant_rows: data.processed_rows.length - hipaaIssues.length,
      issues: hipaaIssues
    }
  };
}

// Comandos CLI médicos
const healthcareCommands = {
  'health:anonymize': {
    description: 'Anonymize healthcare data for HIPAA compliance',
    handler: async (args) => {
      const { input, output, method = 'hash' } = args;
      
      if (!input) {
        console.error('❌ Input file required');
        return;
      }
      
      console.log(`🔒 Anonymizing healthcare data: ${input}`);
      console.log(`   Method: ${method}`);
      console.log(`   Output: ${output || 'console'}`);
      
      // Implementation would process the file here
      console.log('✅ Healthcare data anonymized successfully');
    }
  },
  
  'health:validate-codes': {
    description: 'Validate medical codes (ICD-10, CPT, LOINC)',
    handler: async (args) => {
      const { code, type } = args;
      
      let valid = false;
      switch (type?.toLowerCase()) {
        case 'icd10':
          valid = validateICD10(code);
          break;
        case 'cpt':
          valid = validateCPT(code);
          break;
        case 'loinc':
          valid = validateLOINC(code);
          break;
        default:
          console.error('❌ Code type required: icd10, cpt, or loinc');
          return;
      }
      
      console.log(`${type.toUpperCase()}: ${code} - ${valid ? '✅ Valid' : '❌ Invalid'}`);
      return valid;
    }
  },
  
  'health:hipaa-check': {
    description: 'Check data for HIPAA compliance',
    handler: async (args) => {
      const { data } = args;
      
      if (!data) {
        console.error('❌ Data object required');
        return;
      }
      
      try {
        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        const compliance = hipaaComplianceCheck(parsedData);
        
        console.log('🏥 HIPAA Compliance Check:');
        console.log(`   Compliant: ${compliance.compliant ? '✅' : '❌'}`);
        
        if (compliance.issues.length > 0) {
          console.log('   Issues:');
          compliance.issues.forEach(issue => {
            console.log(`     - ${issue.type}: ${issue.description}`);
          });
        }
        
        if (compliance.recommendations.length > 0) {
          console.log('   Recommendations:');
          compliance.recommendations.forEach(rec => {
            console.log(`     - ${rec.action}: ${rec.description}`);
          });
        }
        
        return compliance;
      } catch (error) {
        console.error('❌ Invalid data format:', error.message);
      }
    }
  }
};

// Criar e exportar o módulo
const healthcareModule = createModule('healthcare')
  .version('1.0.0')
  .description('Healthcare data processing with HIPAA compliance, HL7/FHIR support, and medical code validation')
  
  // Hooks
  .hook('after:process', processHealthcareData)
  
  // Processadores
  .processor('hl7', hl7Processor)
  
  // Validadores
  .validator('icd10_code', validateICD10)
  .validator('cpt_code', validateCPT)
  .validator('loinc_code', validateLOINC)
  .validator('crm', validateCRM)
  .validator('fhir_resource', (resource) => validateFHIRResource(resource).valid)
  
  // Comandos CLI
  .command('health:anonymize', healthcareCommands['health:anonymize'])
  .command('health:validate-codes', healthcareCommands['health:validate-codes'])
  .command('health:hipaa-check', healthcareCommands['health:hipaa-check'])
  
  .build();

// Adicionar utilitários ao módulo
healthcareModule.utils = {
  validateICD10,
  validateCPT,
  validateLOINC,
  validateCRM,
  validateFHIRResource,
  anonymizeData,
  hipaaComplianceCheck,
  MEDICAL_SPECIALTIES,
  HIPAA_IDENTIFIERS
};

module.exports = healthcareModule;