/**
 * GBR-SDK Module System
 * Sistema modular que permite carregar apenas funcionalidades necessárias
 */

class ModuleSystem {
  constructor() {
    this.modules = new Map();
    this.hooks = new Map();
    this.processors = new Map();
    this.validators = new Map();
  }

  /**
   * Register a module
   * @param {string} name - Module name
   * @param {Object} module - Module configuration
   */
  register(name, module) {
    console.log(`📦 Registering module: ${name}`);
    
    // Validate module structure
    this.validateModule(module);
    
    // Store module
    this.modules.set(name, module);
    
    // Register module components
    if (module.hooks) this.registerHooks(name, module.hooks);
    if (module.processors) this.registerProcessors(name, module.processors);
    if (module.validators) this.registerValidators(name, module.validators);
    if (module.commands) this.registerCommands(name, module.commands);
    
    // Initialize module if needed
    if (module.init) {
      module.init();
    }
    
    return this;
  }

  /**
   * Load multiple modules
   * @param {Array} modules - Array of modules to load
   */
  load(modules) {
    for (const module of modules) {
      if (typeof module === 'string') {
        // Load built-in module by name
        this.loadBuiltIn(module);
      } else if (typeof module === 'object') {
        // Load custom module object
        this.register(module.name || 'custom', module);
      }
    }
    return this;
  }

  /**
   * Load built-in module
   * @param {string} name - Module name
   */
  loadBuiltIn(name) {
    try {
      const module = require(`./modules/${name}`);
      this.register(name, module);
    } catch (error) {
      console.warn(`⚠️ Module '${name}' not found or failed to load:`, error.message);
    }
  }

  /**
   * Validate module structure
   * @param {Object} module - Module to validate
   */
  validateModule(module) {
    if (!module.name) throw new Error('Module must have a name');
    if (!module.version) throw new Error('Module must have a version');
    
    // Check for at least one functionality
    const hasFunctionality = module.hooks || 
                           module.processors || 
                           module.validators || 
                           module.commands ||
                           module.routes;
    
    if (!hasFunctionality) {
      throw new Error('Module must provide at least one functionality');
    }
  }

  /**
   * Register hooks from module
   */
  registerHooks(moduleName, hooks) {
    for (const [hookName, handler] of Object.entries(hooks)) {
      if (!this.hooks.has(hookName)) {
        this.hooks.set(hookName, []);
      }
      this.hooks.get(hookName).push({
        module: moduleName,
        handler
      });
    }
  }

  /**
   * Register processors from module
   */
  registerProcessors(moduleName, processors) {
    for (const [format, processor] of Object.entries(processors)) {
      this.processors.set(format, {
        module: moduleName,
        ...processor
      });
    }
  }

  /**
   * Register validators from module
   */
  registerValidators(moduleName, validators) {
    for (const [field, validator] of Object.entries(validators)) {
      this.validators.set(field, {
        module: moduleName,
        validate: validator
      });
    }
  }

  /**
   * Register CLI commands from module
   */
  registerCommands(moduleName, commands) {
    // Commands would be registered with CLI system
    for (const [cmd, config] of Object.entries(commands)) {
      console.log(`  ➕ Command: ${cmd} from ${moduleName}`);
    }
  }

  /**
   * Execute hooks
   * @param {string} hookName - Hook to execute
   * @param {*} data - Data to pass to hook
   */
  async executeHook(hookName, data) {
    const hooks = this.hooks.get(hookName);
    if (!hooks) return data;
    
    let result = data;
    for (const hook of hooks) {
      try {
        result = await hook.handler(result);
      } catch (error) {
        console.error(`Hook error in ${hook.module}:`, error);
      }
    }
    return result;
  }

  /**
   * Get processor for format
   * @param {string} format - File format
   */
  getProcessor(format) {
    return this.processors.get(format);
  }

  /**
   * Validate field using registered validators
   * @param {string} field - Field name
   * @param {*} value - Value to validate
   */
  async validate(field, value) {
    const validator = this.validators.get(field);
    if (!validator) return { valid: true };
    
    try {
      const result = await validator.validate(value);
      return {
        valid: result,
        module: validator.module
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        module: validator.module
      };
    }
  }

  /**
   * List loaded modules
   */
  list() {
    const moduleList = [];
    for (const [name, module] of this.modules) {
      moduleList.push({
        name,
        version: module.version,
        description: module.description,
        features: {
          hooks: module.hooks ? Object.keys(module.hooks).length : 0,
          processors: module.processors ? Object.keys(module.processors).length : 0,
          validators: module.validators ? Object.keys(module.validators).length : 0,
          commands: module.commands ? Object.keys(module.commands).length : 0
        }
      });
    }
    return moduleList;
  }

  /**
   * Check if module is loaded
   * @param {string} name - Module name
   */
  has(name) {
    return this.modules.has(name);
  }

  /**
   * Get module configuration
   * @param {string} name - Module name
   */
  get(name) {
    return this.modules.get(name);
  }

  /**
   * Unload module
   * @param {string} name - Module name
   */
  unload(name) {
    const module = this.modules.get(name);
    if (!module) return false;
    
    // Clean up module resources
    if (module.cleanup) {
      module.cleanup();
    }
    
    // Remove from registry
    this.modules.delete(name);
    
    // Remove hooks
    for (const [hookName, hooks] of this.hooks) {
      const filtered = hooks.filter(h => h.module !== name);
      if (filtered.length === 0) {
        this.hooks.delete(hookName);
      } else {
        this.hooks.set(hookName, filtered);
      }
    }
    
    // Remove processors
    for (const [format, processor] of this.processors) {
      if (processor.module === name) {
        this.processors.delete(format);
      }
    }
    
    // Remove validators
    for (const [field, validator] of this.validators) {
      if (validator.module === name) {
        this.validators.delete(field);
      }
    }
    
    console.log(`📦 Module '${name}' unloaded`);
    return true;
  }
}

/**
 * Module builder helper
 */
class ModuleBuilder {
  constructor(name) {
    this.module = {
      name,
      version: '1.0.0',
      description: '',
      hooks: {},
      processors: {},
      validators: {},
      commands: {},
      routes: {}
    };
  }

  version(v) {
    this.module.version = v;
    return this;
  }

  description(d) {
    this.module.description = d;
    return this;
  }

  hook(name, handler) {
    this.module.hooks[name] = handler;
    return this;
  }

  processor(format, config) {
    this.module.processors[format] = config;
    return this;
  }

  validator(field, validateFn) {
    this.module.validators[field] = validateFn;
    return this;
  }

  command(name, config) {
    this.module.commands[name] = config;
    return this;
  }

  route(method, path, handler) {
    const key = `${method} ${path}`;
    this.module.routes[key] = handler;
    return this;
  }

  build() {
    return this.module;
  }
}

/**
 * Create a new module
 */
function createModule(name) {
  return new ModuleBuilder(name);
}

module.exports = {
  ModuleSystem,
  ModuleBuilder,
  createModule
};