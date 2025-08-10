/**
 * GBR Framework - Main framework class with modular architecture
 */

const { processCsv } = require('../index');
const { ModuleSystem } = require('./module-system');

class GBRFramework {
  constructor(config = {}) {
    this.config = {
      modules: config.modules || [],
      license: config.license || null,
      hooks: config.hooks || {},
      validators: config.validators || {},
      processors: config.processors || {},
      ...config
    };
    
    this.moduleSystem = new ModuleSystem();
    this.initialized = false;
  }
  
  /**
   * Initialize the framework
   */
  async init() {
    if (this.initialized) return this;
    
    console.log('🚀 Initializing GBR Framework...');
    
    // Load modules
    if (this.config.modules.length > 0) {
      console.log(`📦 Loading ${this.config.modules.length} modules...`);
      this.moduleSystem.load(this.config.modules);
    }
    
    // Register custom hooks
    if (Object.keys(this.config.hooks).length > 0) {
      console.log('🪝 Registering custom hooks...');
      for (const [hookName, handler] of Object.entries(this.config.hooks)) {
        this.moduleSystem.registerHooks('custom', { [hookName]: handler });
      }
    }
    
    // Register custom validators
    if (Object.keys(this.config.validators).length > 0) {
      console.log('✅ Registering custom validators...');
      for (const [field, validator] of Object.entries(this.config.validators)) {
        this.moduleSystem.registerValidators('custom', { [field]: validator });
      }
    }
    
    // Register custom processors
    if (Object.keys(this.config.processors).length > 0) {
      console.log('⚙️ Registering custom processors...');
      for (const [format, processor] of Object.entries(this.config.processors)) {
        this.moduleSystem.registerProcessors('custom', { [format]: processor });
      }
    }
    
    // Show loaded modules
    const modules = this.moduleSystem.list();
    console.log('📋 Loaded modules:', modules.map(m => `${m.name}@${m.version}`).join(', '));
    
    this.initialized = true;
    console.log('✅ GBR Framework initialized\n');
    
    return this;
  }
  
  /**
   * Process file with framework
   */
  async process(filePath, options = {}) {
    if (!this.initialized) {
      await this.init();
    }
    
    console.log(`📄 Processing: ${filePath}`);
    
    try {
      // Execute before:process hooks
      let data = { 
        filePath, 
        options,
        source: 'framework',
        license: this.config.license
      };
      data = await this.moduleSystem.executeHook('before:process', data);
      
      // Determine processor based on file extension
      const extension = this.getFileExtension(filePath);
      const processor = this.moduleSystem.getProcessor(extension);
      
      let result;
      
      if (processor) {
        console.log(`⚙️ Using ${processor.module} processor for ${extension}`);
        result = await processor.process(filePath, options);
      } else {
        // Default to CSV processing via WASM
        console.log('⚙️ Using default WASM CSV processor');
        result = await processCsv(filePath);
      }
      
      // Add metadata
      result.metadata = {
        framework: 'gbr-sdk',
        version: '1.0.0',
        processedAt: new Date().toISOString(),
        processor: processor ? processor.module : 'wasm-csv',
        modules: this.moduleSystem.list().map(m => m.name),
        ...result.metadata
      };
      
      // Execute after:process hooks
      result = await this.moduleSystem.executeHook('after:process', result);
      
      // Execute validation hooks
      if (result.processed_rows) {
        result = await this.moduleSystem.executeHook('after:validate', result);
      }
      
      console.log(`✅ Processed ${result.processed_rows?.length || 0} rows with ${result.errors?.length || 0} errors`);
      
      return result;
      
    } catch (error) {
      console.error('❌ Processing failed:', error.message);
      
      // Execute error hooks
      await this.moduleSystem.executeHook('on:error', error);
      
      throw error;
    }
  }
  
  /**
   * Validate data using framework validators
   */
  async validate(data) {
    if (!this.initialized) {
      await this.init();
    }
    
    const results = [];
    
    if (Array.isArray(data)) {
      // Validate array of objects
      for (let i = 0; i < data.length; i++) {
        const itemResults = await this.validateObject(data[i], i);
        results.push(...itemResults);
      }
    } else if (typeof data === 'object') {
      // Validate single object
      const itemResults = await this.validateObject(data, 0);
      results.push(...itemResults);
    }
    
    return {
      valid: results.every(r => r.valid),
      errors: results.filter(r => !r.valid),
      results
    };
  }
  
  async validateObject(obj, index) {
    const results = [];
    
    for (const [field, value] of Object.entries(obj)) {
      const validation = await this.moduleSystem.validate(field, value);
      results.push({
        field,
        value,
        valid: validation.valid,
        error: validation.error,
        module: validation.module,
        index
      });
    }
    
    return results;
  }
  
  /**
   * Get available processors
   */
  getProcessors() {
    const processors = [];
    for (const [format, processor] of this.moduleSystem.processors) {
      processors.push({
        format,
        module: processor.module,
        extensions: processor.extensions,
        description: processor.description
      });
    }
    return processors;
  }
  
  /**
   * Get available validators
   */
  getValidators() {
    const validators = [];
    for (const [field, validator] of this.moduleSystem.validators) {
      validators.push({
        field,
        module: validator.module
      });
    }
    return validators;
  }
  
  /**
   * Get loaded modules
   */
  getModules() {
    return this.moduleSystem.list();
  }
  
  /**
   * Add module to framework
   */
  addModule(module) {
    if (typeof module === 'string') {
      this.moduleSystem.loadBuiltIn(module);
    } else {
      this.moduleSystem.register(module.name, module);
    }
    return this;
  }
  
  /**
   * Remove module from framework
   */
  removeModule(name) {
    return this.moduleSystem.unload(name);
  }
  
  /**
   * Get file extension
   */
  getFileExtension(filePath) {
    const parts = filePath.split('.');
    return parts.length > 1 ? '.' + parts.pop().toLowerCase() : '';
  }
  
  /**
   * Create a customized version of the framework
   */
  static customize(config) {
    return new GBRFramework(config);
  }
  
  /**
   * Create framework instance
   */
  static create(config) {
    const framework = new GBRFramework(config);
    return framework.init();
  }
}

// Export both the class and a default instance
module.exports = {
  GBRFramework,
  default: GBRFramework,
  
  // Convenience methods
  customize: GBRFramework.customize,
  create: GBRFramework.create,
  
  // Re-export core functions
  processCsv
};