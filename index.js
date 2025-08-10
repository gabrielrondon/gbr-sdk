const fs = require('fs').promises;
const { process_csv_data } = require('./pkg/processor.js');

/**
 * Processes a CSV file using the high-performance WebAssembly module.
 *
 * @param {string} filePath The path to the CSV file.
 * @returns {Promise<object>} A promise that resolves to an object containing processedRows and errors.
 */
async function processCsv(filePath) {
  try {
    // Read the entire file content asynchronously
    const csvContent = await fs.readFile(filePath, 'utf8');

    // Call the WASM function with the CSV content string
    const resultJson = process_csv_data(csvContent);

    // Parse the JSON result string to a JavaScript object
    const result = JSON.parse(resultJson);

    return result;
  } catch (e) {
    // Handle file reading errors or other unexpected issues
    throw new Error(`Failed to process CSV with Wasm module: ${e.message}`);
  }
}

/**
 * Synchronous version of processCsv for backwards compatibility.
 * @deprecated Use processCsv instead for better performance.
 *
 * @param {string} filePath The path to the CSV file.
 * @returns {object} An object containing processedRows and errors.
 */
function processCsvSync(filePath) {
  const fsSync = require('fs');
  try {
    // Read the entire file content synchronously
    const csvContent = fsSync.readFileSync(filePath, 'utf8');

    // Call the WASM function with the CSV content string
    const resultJson = process_csv_data(csvContent);

    // Parse the JSON result string to a JavaScript object
    const result = JSON.parse(resultJson);

    return result;
  } catch (e) {
    // Handle file reading errors or other unexpected issues
    throw new Error(`Failed to process CSV with Wasm module: ${e.message}`);
  }
}

module.exports = { processCsv, processCsvSync };