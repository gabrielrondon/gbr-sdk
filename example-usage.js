/**
 * Example usage of GBR-SDK with modular architecture
 */

const { GBRFramework } = require('./lib/gbr-framework');

// Example 1: Basic usage with modules
async function basicExample() {
  console.log('🔥 Example 1: Basic Framework Usage\n');
  
  const framework = await GBRFramework.create({
    modules: ['brazilian', 'excel'],
    license: 'DEMO-LICENSE-KEY'
  });
  
  // Process CSV file
  const result = await framework.process('./test-data.csv');
  
  console.log('Results:', {
    rows: result.processed_rows.length,
    errors: result.errors.length,
    modules: result.metadata.modules
  });
  
  return result;
}

// Example 2: Banking application
async function bankingExample() {
  console.log('🏦 Example 2: Banking Application\n');
  
  const bankingFramework = GBRFramework.customize({
    name: 'BankProcessor',
    modules: ['brazilian'],
    validators: {
      'account_number': (value) => {
        return /^\d{6,12}$/.test(value);
      },
      'amount': (value) => {
        return typeof value === 'number' && value > 0;
      }
    },
    hooks: {
      'before:process': async (data) => {
        console.log('🔒 Banking: Applying security filters...');
        return data;
      },
      'after:process': async (result) => {
        console.log('📊 Banking: Generating compliance report...');
        result.compliance = {
          checked: true,
          bacenCompliant: true,
          riskScore: 'LOW'
        };
        return result;
      }
    }
  });
  
  await bankingFramework.init();
  
  // Validate banking data
  const validationResult = await bankingFramework.validate([
    {
      cpf: '11122233344',
      account_number: '1234567',
      amount: 1000.50
    },
    {
      cpf: '12345678901', // Invalid CPF
      account_number: '123', // Too short
      amount: -100 // Invalid amount
    }
  ]);
  
  console.log('Validation results:', {
    valid: validationResult.valid,
    totalErrors: validationResult.errors.length
  });
  
  return validationResult;
}

// Example 3: E-commerce application
async function ecommerceExample() {
  console.log('🛒 Example 3: E-commerce Application\n');
  
  const ecommerceFramework = GBRFramework.customize({
    name: 'ProductImporter',
    modules: ['excel', 'api'],
    processors: {
      '.json': {
        extensions: ['.json'],
        process: async (filePath) => {
          console.log('📦 Processing product JSON...');
          // Custom JSON processor
          return {
            processed_rows: [
              { line: 1, data: { sku: 'PROD001', name: 'Product 1' }, hash: 'json123' }
            ],
            errors: [],
            format: 'json'
          };
        }
      }
    },
    validators: {
      'sku': (value) => /^[A-Z0-9-]+$/.test(value),
      'price': (value) => value >= 0,
      'stock': (value) => Number.isInteger(value) && value >= 0
    }
  });
  
  await ecommerceFramework.init();
  
  console.log('Available processors:', 
    ecommerceFramework.getProcessors().map(p => p.format).join(', ')
  );
  
  console.log('Available validators:', 
    ecommerceFramework.getValidators().map(v => v.field).join(', ')
  );
  
  return ecommerceFramework;
}

// Example 4: Healthcare application
async function healthcareExample() {
  console.log('🏥 Example 4: Healthcare Application\n');
  
  const healthcareFramework = GBRFramework.customize({
    name: 'MedicalDataProcessor',
    modules: ['brazilian'],
    hooks: {
      'before:process': async (data) => {
        console.log('🔐 Healthcare: Applying HIPAA compliance...');
        return data;
      },
      'after:process': async (result) => {
        console.log('🔒 Healthcare: Anonymizing sensitive data...');
        
        // Anonymize CPF in processed data
        result.processed_rows.forEach(row => {
          if (row.data.cpf) {
            row.data.cpf = row.data.cpf.replace(/\d{3}$/, 'XXX');
          }
        });
        
        result.hipaaCompliant = true;
        return result;
      }
    },
    validators: {
      'patient_id': (value) => /^PAT\d{6}$/.test(value),
      'diagnosis_code': (value) => /^[A-Z]\d{2}$/.test(value)
    }
  });
  
  await healthcareFramework.init();
  
  // Test validation
  const patientData = {
    patient_id: 'PAT123456',
    cpf: '11122233344',
    diagnosis_code: 'A01'
  };
  
  const validation = await healthcareFramework.validate(patientData);
  console.log('Patient data validation:', validation.valid ? '✅ Valid' : '❌ Invalid');
  
  return healthcareFramework;
}

// Example 5: Module development
function moduleExample() {
  console.log('🧩 Example 5: Custom Module Development\n');
  
  const { createModule } = require('./lib/module-system');
  
  // Create a custom logistics module
  const logisticsModule = createModule('logistics')
    .version('1.0.0')
    .description('Logistics and shipping validators')
    
    .validator('tracking_code', (value) => {
      return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(value);
    })
    
    .validator('zip_code', (value) => {
      return /^\d{5}-?\d{3}$/.test(value);
    })
    
    .hook('before:process', async (data) => {
      console.log('📦 Logistics: Validating shipping data...');
      return data;
    })
    
    .processor('tracking', {
      extensions: ['.trk'],
      process: async (filePath) => {
        console.log('📋 Processing tracking file...');
        return {
          processed_rows: [],
          errors: [],
          format: 'tracking'
        };
      }
    })
    
    .command('logistics:track', {
      description: 'Track package by code',
      handler: async (args) => {
        console.log(`📦 Tracking package: ${args.code}`);
        return { status: 'delivered', location: 'São Paulo' };
      }
    })
    
    .build();
  
  console.log('Custom logistics module created:', logisticsModule.name);
  
  return logisticsModule;
}

// Run examples
async function runExamples() {
  try {
    console.log('🚀 GBR-SDK Modular Framework Examples\n');
    console.log('=' .repeat(60) + '\n');
    
    await basicExample();
    console.log('\n' + '='.repeat(60) + '\n');
    
    await bankingExample();
    console.log('\n' + '='.repeat(60) + '\n');
    
    await ecommerceExample();
    console.log('\n' + '='.repeat(60) + '\n');
    
    await healthcareExample();
    console.log('\n' + '='.repeat(60) + '\n');
    
    moduleExample();
    console.log('\n' + '='.repeat(60) + '\n');
    
    console.log('✅ All examples completed successfully!');
    
  } catch (error) {
    console.error('❌ Example failed:', error.message);
  }
}

// Export examples for testing
module.exports = {
  basicExample,
  bankingExample,
  ecommerceExample,
  healthcareExample,
  moduleExample,
  runExamples
};

// Run if called directly
if (require.main === module) {
  runExamples();
}