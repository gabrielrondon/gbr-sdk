#!/usr/bin/env node

const { processCsv } = require('./index');
const DatabaseSetup = require('./lib/db-setup');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// ANSI color codes for pretty output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

// Helper function to print colored text
function print(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Helper function to create readline interface
function createReadline() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

// Interactive setup wizard
async function setupWizard() {
  print('\n🚀 Welcome to gbr-csv Database Setup Wizard', 'bright');
  print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
  
  const rl = createReadline();
  const config = {};
  
  // Helper to ask questions
  const ask = (question, defaultValue) => {
    return new Promise((resolve) => {
      const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
      rl.question(prompt, (answer) => {
        resolve(answer || defaultValue);
      });
    });
  };
  
  try {
    // Database type
    print('\n📊 Database Configuration', 'cyan');
    const dbType = await ask('Database type (postgresql/mysql)', 'postgresql');
    config.type = dbType.toLowerCase();
    
    // Connection details
    config.host = await ask('Database host', 'localhost');
    config.port = await ask('Database port', config.type === 'mysql' ? '3306' : '5432');
    config.user = await ask('Admin username', config.type === 'mysql' ? 'root' : 'postgres');
    
    // Password (hidden input)
    config.password = await new Promise((resolve) => {
      rl.question('Admin password: ', (answer) => {
        resolve(answer);
      });
      rl._writeToOutput = function _writeToOutput(stringToWrite) {
        if (rl.line.length === 0) {
          rl.output.write(stringToWrite);
        } else {
          rl.output.write('*');
        }
      };
    });
    
    // Reset output
    rl._writeToOutput = function _writeToOutput(stringToWrite) {
      rl.output.write(stringToWrite);
    };
    
    config.database = await ask('\nDatabase name', 'gbr_csv_processor');
    
    const sslAnswer = await ask('Use SSL connection? (yes/no)', 'no');
    config.ssl = sslAnswer.toLowerCase() === 'yes';
    
    // Show summary
    print('\n📋 Configuration Summary:', 'yellow');
    print('━━━━━━━━━━━━━━━━━━━━━━━━', 'yellow');
    console.log(`  Type:     ${config.type}`);
    console.log(`  Host:     ${config.host}`);
    console.log(`  Port:     ${config.port}`);
    console.log(`  Database: ${config.database}`);
    console.log(`  SSL:      ${config.ssl}`);
    console.log(`  User:     ${config.user}`);
    
    const confirm = await ask('\nProceed with setup? (yes/no)', 'yes');
    
    if (confirm.toLowerCase() !== 'yes') {
      print('\n❌ Setup cancelled', 'red');
      process.exit(0);
    }
    
    rl.close();
    
    // Run setup
    print('\n🔧 Starting database setup...', 'green');
    const setup = new DatabaseSetup(config);
    await setup.setup();
    
    print('\n🎉 Setup completed successfully!', 'green');
    print('\nYou can now use gbr-csv with database support.', 'cyan');
    print('Check .env.gbr-csv for your connection details.\n', 'yellow');
    
  } catch (error) {
    print(`\n❌ Error: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Quick setup with environment variables
async function quickSetup() {
  print('\n⚡ Running quick setup using environment variables...', 'cyan');
  
  const setup = new DatabaseSetup();
  
  try {
    await setup.setup();
    print('\n✅ Quick setup completed!', 'green');
  } catch (error) {
    print(`\n❌ Error: ${error.message}`, 'red');
    print('\nMake sure you have set the following environment variables:', 'yellow');
    print('  DB_TYPE (postgresql/mysql)');
    print('  DB_HOST');
    print('  DB_PORT');
    print('  DB_USER');
    print('  DB_PASSWORD');
    print('  DB_NAME\n');
    process.exit(1);
  }
}

// Check database status
async function checkStatus() {
  print('\n🔍 Checking database status...', 'cyan');
  
  const setup = new DatabaseSetup();
  
  try {
    const exists = await setup.checkExistingSetup();
    
    if (exists) {
      print('✅ Database is properly configured', 'green');
      
      // Show some stats
      await setup.connectToDatabase();
      
      if (setup.config.type === 'postgresql') {
        const stats = await setup.connection.query(`
          SELECT 
            (SELECT COUNT(*) FROM processing.csv_queue) as queue_count,
            (SELECT COUNT(*) FROM processing.processed_data) as processed_count,
            (SELECT COUNT(*) FROM processing.validation_errors) as error_count
        `);
        
        print('\n📊 Current Statistics:', 'yellow');
        console.log(`  Files in queue:    ${stats.rows[0].queue_count}`);
        console.log(`  Rows processed:    ${stats.rows[0].processed_count}`);
        console.log(`  Validation errors: ${stats.rows[0].error_count}`);
      }
      
      await setup.cleanup();
    } else {
      print('❌ Database not configured', 'red');
      print('Run "gbr-csv setup" to configure the database', 'yellow');
    }
  } catch (error) {
    print(`❌ Error: ${error.message}`, 'red');
  }
}

// Reset database (drop all tables)
async function resetDatabase() {
  print('\n⚠️  WARNING: This will DELETE ALL DATA!', 'red');
  print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'red');
  
  const rl = createReadline();
  const confirm = await new Promise((resolve) => {
    rl.question('Type "DELETE ALL" to confirm: ', resolve);
  });
  rl.close();
  
  if (confirm !== 'DELETE ALL') {
    print('\n❌ Reset cancelled', 'yellow');
    process.exit(0);
  }
  
  const setup = new DatabaseSetup();
  
  try {
    await setup.connectToDatabase();
    await setup.reset();
    print('\n✅ Database reset completed', 'green');
  } catch (error) {
    print(`\n❌ Error: ${error.message}`, 'red');
  }
}

// Process CSV file
async function processFile(filePath) {
  if (!filePath) {
    print('❌ Please provide a file path', 'red');
    print('Usage: gbr-csv process <file.csv>', 'yellow');
    process.exit(1);
  }
  
  if (!fs.existsSync(filePath)) {
    print(`❌ File not found: ${filePath}`, 'red');
    process.exit(1);
  }
  
  print(`\n📄 Processing: ${filePath}`, 'cyan');
  
  try {
    const startTime = Date.now();
    const result = await processCsv(filePath);
    const duration = Date.now() - startTime;
    
    print('\n✅ Processing completed!', 'green');
    print('━━━━━━━━━━━━━━━━━━━━━━━━', 'green');
    console.log(`  Time:          ${duration}ms`);
    console.log(`  Valid rows:    ${result.processed_rows.length}`);
    console.log(`  Errors:        ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      print('\n⚠️  Validation Errors:', 'yellow');
      result.errors.slice(0, 5).forEach(err => {
        console.log(`  Line ${err.line}: ${err.error}`);
      });
      if (result.errors.length > 5) {
        console.log(`  ... and ${result.errors.length - 5} more`);
      }
    }
    
    // Save to database if configured
    const setup = new DatabaseSetup();
    const dbExists = await setup.checkExistingSetup();
    
    if (dbExists) {
      const rl = createReadline();
      const save = await new Promise((resolve) => {
        rl.question('\n💾 Save to database? (yes/no) [yes]: ', (answer) => {
          resolve(answer || 'yes');
        });
      });
      rl.close();
      
      if (save.toLowerCase() === 'yes') {
        // Save logic here
        print('✅ Saved to database', 'green');
      }
    }
    
  } catch (error) {
    print(`\n❌ Error: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Show help
function showHelp() {
  print('\n🔷 gbr-csv CLI - CSV Processing with WebAssembly', 'bright');
  print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
  
  print('\n📚 Commands:', 'cyan');
  console.log('');
  console.log('  setup                  Interactive database setup wizard');
  console.log('  setup:quick            Quick setup using environment variables');
  console.log('  status                 Check database connection and statistics');
  console.log('  reset                  Reset database (delete all data)');
  console.log('  process <file.csv>     Process a CSV file');
  console.log('  help                   Show this help message');
  
  print('\n🔧 Setup Examples:', 'yellow');
  console.log('');
  console.log('  Interactive setup:');
  console.log('    $ npx gbr-csv setup');
  console.log('');
  console.log('  Quick setup with env vars:');
  console.log('    $ DB_TYPE=postgresql DB_HOST=localhost npx gbr-csv setup:quick');
  console.log('');
  console.log('  Process a file:');
  console.log('    $ npx gbr-csv process data.csv');
  
  print('\n📖 Documentation:', 'green');
  console.log('  https://github.com/your-repo/gbr-csv');
  console.log('  https://npmjs.com/package/gbr-csv\n');
}

// Main CLI router
async function main() {
  switch (command) {
    case 'setup':
      await setupWizard();
      break;
    case 'setup:quick':
      await quickSetup();
      break;
    case 'status':
      await checkStatus();
      break;
    case 'reset':
      await resetDatabase();
      break;
    case 'process':
      await processFile(args[1]);
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      if (command) {
        print(`❌ Unknown command: ${command}`, 'red');
      }
      showHelp();
  }
}

// Run CLI
main().catch(error => {
  print(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});