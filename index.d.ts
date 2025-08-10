/**
 * Represents a successfully processed CSV row.
 */
export interface ProcessedRow {
  /** The line number in the original CSV file (starting from 2, accounting for header) */
  line: number;
  /** The parsed data as a key-value object */
  data: Record<string, string>;
  /** SHA-256 hash of the row data */
  hash: string;
}

/**
 * Represents a validation error for a CSV row.
 */
export interface ValidationError {
  /** The line number where the error occurred */
  line: number;
  /** Description of the validation error */
  error: string;
  /** The raw CSV data that failed validation */
  raw_data: string;
}

/**
 * Result object returned from CSV processing.
 */
export interface ProcessingResult {
  /** Array of successfully processed rows */
  processed_rows: ProcessedRow[];
  /** Array of validation errors encountered during processing */
  errors: ValidationError[];
}

/**
 * Processes a CSV file using the high-performance WebAssembly module.
 * 
 * @param filePath - The path to the CSV file to process
 * @returns A promise that resolves to an object containing processed rows and validation errors
 * @throws {Error} If the file cannot be read or processed
 * 
 * @example
 * ```typescript
 * import { processCsv } from 'gbr-csv';
 * 
 * const result = await processCsv('./data.csv');
 * console.log(`Processed ${result.processed_rows.length} rows`);
 * console.log(`Found ${result.errors.length} errors`);
 * ```
 */
export function processCsv(filePath: string): Promise<ProcessingResult>;

/**
 * Synchronous version of processCsv for backwards compatibility.
 * @deprecated Use processCsv instead for better performance.
 * 
 * @param filePath - The path to the CSV file to process
 * @returns An object containing processed rows and validation errors
 * @throws {Error} If the file cannot be read or processed
 * 
 * @example
 * ```typescript
 * import { processCsvSync } from 'gbr-csv';
 * 
 * const result = processCsvSync('./data.csv');
 * console.log(`Processed ${result.processed_rows.length} rows`);
 * ```
 */
export function processCsvSync(filePath: string): ProcessingResult;