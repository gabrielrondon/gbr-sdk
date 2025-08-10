/**
 * Marketplace Module - Plugin marketplace with discovery, installation, and management
 */

const { createModule } = require('../module-system');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

class PluginMarketplace {
  constructor(config = {}) {
    this.config = {
      registryUrl: config.registryUrl || 'https://registry.gbr-sdk.com',
      localPath: config.localPath || './plugins',
      cacheTime: config.cacheTime || 3600000, // 1 hour
      autoUpdate: config.autoUpdate !== false,
      trustedPublishers: config.trustedPublishers || ['gbr-official'],
      allowBeta: config.allowBeta || false,
      ...config
    };
    
    this.plugins = new Map();
    this.installedPlugins = new Map();
    this.cache = new Map();
    
    this.init();
  }
  
  async init() {
    console.log('🏪 Initializing plugin marketplace...');
    
    // Create plugins directory
    if (!fs.existsSync(this.config.localPath)) {
      fs.mkdirSync(this.config.localPath, { recursive: true });
    }
    
    // Load installed plugins
    await this.loadInstalledPlugins();
    
    // Load marketplace cache
    await this.loadMarketplaceCache();
    
    console.log(`✅ Marketplace initialized with ${this.installedPlugins.size} installed plugins`);
  }
  
  /**
   * Search plugins in marketplace
   */
  async searchPlugins(query, options = {}) {
    console.log(`🔍 Searching plugins: "${query}"`);
    
    const { category, tags, publisher, includeInstalled = false } = options;
    
    // Get available plugins (from cache or fetch)
    const availablePlugins = await this.getAvailablePlugins();
    
    let results = availablePlugins.filter(plugin => {
      // Text search
      if (query && !plugin.name.toLowerCase().includes(query.toLowerCase()) &&
          !plugin.description.toLowerCase().includes(query.toLowerCase())) {
        return false;
      }
      
      // Category filter
      if (category && plugin.category !== category) {
        return false;
      }
      
      // Tags filter
      if (tags) {
        const searchTags = Array.isArray(tags) ? tags : [tags];
        if (!searchTags.some(tag => plugin.tags.includes(tag))) {
          return false;
        }
      }
      
      // Publisher filter
      if (publisher && plugin.publisher !== publisher) {
        return false;
      }
      
      // Beta filter
      if (!this.config.allowBeta && plugin.version.includes('beta')) {
        return false;
      }
      
      // Include installed filter
      if (!includeInstalled && this.installedPlugins.has(plugin.name)) {
        return false;
      }
      
      return true;
    });
    
    // Sort by downloads (most popular first)
    results.sort((a, b) => b.downloads - a.downloads);
    
    console.log(`📦 Found ${results.length} plugins`);
    return results;
  }
  
  /**
   * Get plugin details
   */
  async getPluginDetails(pluginName) {
    const plugin = await this.fetchPluginInfo(pluginName);
    
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }
    
    // Add installation status
    plugin.installed = this.installedPlugins.has(pluginName);
    
    if (plugin.installed) {
      const installed = this.installedPlugins.get(pluginName);
      plugin.installedVersion = installed.version;
      plugin.updateAvailable = this.compareVersions(plugin.version, installed.version) > 0;
    }
    
    return plugin;
  }
  
  /**
   * Install plugin
   */
  async installPlugin(pluginName, options = {}) {
    console.log(`📦 Installing plugin: ${pluginName}`);
    
    const { version = 'latest', force = false } = options;
    
    // Check if already installed
    if (this.installedPlugins.has(pluginName) && !force) {
      throw new Error(`Plugin already installed: ${pluginName}. Use --force to reinstall.`);
    }
    
    // Get plugin details
    const plugin = await this.fetchPluginInfo(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }
    
    // Security check
    await this.securityCheck(plugin);
    
    // Download plugin
    const pluginData = await this.downloadPlugin(plugin, version);
    
    // Verify integrity
    await this.verifyPluginIntegrity(pluginData, plugin);
    
    // Install plugin
    const installPath = path.join(this.config.localPath, pluginName);
    await this.extractPlugin(pluginData, installPath);
    
    // Load and validate plugin
    const loadedPlugin = await this.loadPlugin(installPath);
    
    // Register installed plugin
    this.installedPlugins.set(pluginName, {
      name: pluginName,
      version: plugin.version,
      installPath,
      installedAt: new Date().toISOString(),
      plugin: loadedPlugin
    });
    
    // Save installation registry
    await this.saveInstalledPlugins();
    
    console.log(`✅ Plugin installed: ${pluginName}@${plugin.version}`);
    
    return {
      name: pluginName,
      version: plugin.version,
      installPath,
      installedAt: new Date().toISOString()
    };
  }
  
  /**
   * Uninstall plugin
   */
  async uninstallPlugin(pluginName, options = {}) {
    console.log(`🗑️ Uninstalling plugin: ${pluginName}`);
    
    const { removeData = false } = options;
    
    if (!this.installedPlugins.has(pluginName)) {
      throw new Error(`Plugin not installed: ${pluginName}`);
    }
    
    const installed = this.installedPlugins.get(pluginName);
    
    // Remove plugin files
    if (fs.existsSync(installed.installPath)) {
      await this.removeDirectory(installed.installPath);
    }
    
    // Remove from registry
    this.installedPlugins.delete(pluginName);
    await this.saveInstalledPlugins();
    
    console.log(`✅ Plugin uninstalled: ${pluginName}`);
    return true;
  }
  
  /**
   * Update plugin
   */
  async updatePlugin(pluginName, options = {}) {
    console.log(`🔄 Updating plugin: ${pluginName}`);
    
    if (!this.installedPlugins.has(pluginName)) {
      throw new Error(`Plugin not installed: ${pluginName}`);
    }
    
    const installed = this.installedPlugins.get(pluginName);
    const latest = await this.fetchPluginInfo(pluginName);
    
    if (this.compareVersions(latest.version, installed.version) <= 0) {
      console.log(`✅ Plugin already up to date: ${pluginName}@${installed.version}`);
      return false;
    }
    
    // Backup current version
    const backupPath = `${installed.installPath}.backup.${Date.now()}`;
    if (fs.existsSync(installed.installPath)) {
      fs.renameSync(installed.installPath, backupPath);
    }
    
    try {
      // Install new version
      await this.installPlugin(pluginName, { force: true });
      
      // Remove backup
      if (fs.existsSync(backupPath)) {
        await this.removeDirectory(backupPath);
      }
      
      console.log(`✅ Plugin updated: ${pluginName} ${installed.version} → ${latest.version}`);
      return true;
      
    } catch (error) {
      // Restore backup on failure
      if (fs.existsSync(backupPath)) {
        if (fs.existsSync(installed.installPath)) {
          await this.removeDirectory(installed.installPath);
        }
        fs.renameSync(backupPath, installed.installPath);
      }
      throw error;
    }
  }
  
  /**
   * List installed plugins
   */
  listInstalled() {
    return Array.from(this.installedPlugins.values());
  }
  
  /**
   * Check for updates
   */
  async checkUpdates() {
    console.log('🔍 Checking for plugin updates...');
    
    const updates = [];
    
    for (const [name, installed] of this.installedPlugins) {
      try {
        const latest = await this.fetchPluginInfo(name);
        
        if (this.compareVersions(latest.version, installed.version) > 0) {
          updates.push({
            name,
            currentVersion: installed.version,
            latestVersion: latest.version,
            description: latest.description
          });
        }
      } catch (error) {
        console.warn(`Failed to check updates for ${name}:`, error.message);
      }
    }
    
    console.log(`📦 Found ${updates.length} available updates`);
    return updates;
  }
  
  /**
   * Update all plugins
   */
  async updateAll() {
    const updates = await this.checkUpdates();
    const results = [];
    
    for (const update of updates) {
      try {
        await this.updatePlugin(update.name);
        results.push({ name: update.name, success: true });
      } catch (error) {
        results.push({ name: update.name, success: false, error: error.message });
      }
    }
    
    return results;
  }
  
  /**
   * Plugin categories
   */
  getCategories() {
    return [
      'data-processing',
      'validation',
      'transformation',
      'export',
      'security',
      'integration',
      'monitoring',
      'utilities',
      'industry-specific'
    ];
  }
  
  // Private methods
  async getAvailablePlugins() {
    const cacheKey = 'available-plugins';
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.config.cacheTime) {
      return cached.data;
    }
    
    try {
      // Simulate marketplace API call
      const plugins = this.getMockMarketplacePlugins();
      
      this.cache.set(cacheKey, {
        data: plugins,
        timestamp: Date.now()
      });
      
      return plugins;
    } catch (error) {
      console.warn('Failed to fetch plugins from marketplace:', error.message);
      return cached ? cached.data : [];
    }
  }
  
  getMockMarketplacePlugins() {
    return [
      {
        name: 'xml-processor',
        version: '1.2.0',
        description: 'Advanced XML file processor with schema validation',
        publisher: 'gbr-official',
        category: 'data-processing',
        tags: ['xml', 'schema', 'validation'],
        downloads: 15420,
        rating: 4.8,
        license: 'MIT',
        homepage: 'https://github.com/gbr-sdk/xml-processor',
        dependencies: []
      },
      {
        name: 'pdf-extractor',
        version: '2.1.5',
        description: 'Extract data from PDF documents with OCR support',
        publisher: 'gbr-community',
        category: 'data-processing',
        tags: ['pdf', 'ocr', 'extraction'],
        downloads: 8930,
        rating: 4.5,
        license: 'Apache-2.0',
        homepage: 'https://github.com/community/pdf-extractor',
        dependencies: ['tesseract']
      },
      {
        name: 'sap-connector',
        version: '3.0.1',
        description: 'Connect and extract data from SAP systems',
        publisher: 'enterprise-solutions',
        category: 'integration',
        tags: ['sap', 'erp', 'enterprise'],
        downloads: 4250,
        rating: 4.9,
        license: 'Commercial',
        homepage: 'https://enterprise-solutions.com/sap-connector',
        dependencies: ['sap-sdk']
      },
      {
        name: 'ml-validator',
        version: '1.0.0-beta.2',
        description: 'Machine learning powered data validation',
        publisher: 'ai-labs',
        category: 'validation',
        tags: ['ml', 'ai', 'validation', 'anomaly-detection'],
        downloads: 1250,
        rating: 4.2,
        license: 'MIT',
        homepage: 'https://ai-labs.com/ml-validator',
        dependencies: ['tensorflow']
      },
      {
        name: 'blockchain-tracker',
        version: '0.5.2',
        description: 'Track and validate blockchain transactions',
        publisher: 'crypto-tools',
        category: 'validation',
        tags: ['blockchain', 'crypto', 'ethereum', 'bitcoin'],
        downloads: 890,
        rating: 4.1,
        license: 'GPL-3.0',
        homepage: 'https://crypto-tools.org/blockchain-tracker',
        dependencies: ['web3']
      }
    ];
  }
  
  async fetchPluginInfo(pluginName) {
    const plugins = await this.getAvailablePlugins();
    return plugins.find(p => p.name === pluginName);
  }
  
  async securityCheck(plugin) {
    console.log('🔒 Running security checks...');
    
    // Check publisher trust
    if (!this.config.trustedPublishers.includes(plugin.publisher)) {
      console.warn(`⚠️ Untrusted publisher: ${plugin.publisher}`);
    }
    
    // Check license
    const suspiciousLicenses = ['Unknown', 'Proprietary', 'None'];
    if (suspiciousLicenses.includes(plugin.license)) {
      console.warn(`⚠️ Suspicious license: ${plugin.license}`);
    }
    
    // Rating check
    if (plugin.rating < 3.0) {
      console.warn(`⚠️ Low rating: ${plugin.rating}/5.0`);
    }
    
    return true;
  }
  
  async downloadPlugin(plugin, version) {
    console.log(`  📥 Downloading ${plugin.name}@${version}...`);
    
    // Simulate download
    const mockPluginData = {
      name: plugin.name,
      version: plugin.version,
      files: {
        'index.js': `// ${plugin.name} plugin\nmodule.exports = { name: '${plugin.name}' };`,
        'package.json': JSON.stringify({
          name: plugin.name,
          version: plugin.version,
          description: plugin.description
        }, null, 2),
        'README.md': `# ${plugin.name}\n\n${plugin.description}`
      }
    };
    
    return Buffer.from(JSON.stringify(mockPluginData));
  }
  
  async verifyPluginIntegrity(pluginData, plugin) {
    console.log('  ✅ Verifying plugin integrity...');
    
    // Calculate checksum
    const checksum = crypto.createHash('sha256').update(pluginData).digest('hex');
    
    // In real implementation, would verify against published checksum
    return checksum;
  }
  
  async extractPlugin(pluginData, installPath) {
    console.log(`  📦 Extracting to ${installPath}...`);
    
    // Create install directory
    if (!fs.existsSync(installPath)) {
      fs.mkdirSync(installPath, { recursive: true });
    }
    
    // Parse plugin data
    const pluginInfo = JSON.parse(pluginData.toString());
    
    // Write files
    for (const [filename, content] of Object.entries(pluginInfo.files)) {
      const filePath = path.join(installPath, filename);
      fs.writeFileSync(filePath, content);
    }
  }
  
  async loadPlugin(installPath) {
    const packagePath = path.join(installPath, 'package.json');
    const indexPath = path.join(installPath, 'index.js');
    
    if (!fs.existsSync(packagePath) || !fs.existsSync(indexPath)) {
      throw new Error('Invalid plugin structure');
    }
    
    // Load plugin module
    const pluginModule = require(indexPath);
    
    return pluginModule;
  }
  
  async removeDirectory(dirPath) {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }
  
  compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(n => parseInt(n));
    const parts2 = v2.split('.').map(n => parseInt(n));
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;
      
      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }
    
    return 0;
  }
  
  async loadInstalledPlugins() {
    const registryPath = path.join(this.config.localPath, 'installed.json');
    
    if (fs.existsSync(registryPath)) {
      try {
        const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        
        for (const plugin of registry.plugins || []) {
          this.installedPlugins.set(plugin.name, plugin);
        }
      } catch (error) {
        console.warn('Failed to load installed plugins registry:', error.message);
      }
    }
  }
  
  async saveInstalledPlugins() {
    const registryPath = path.join(this.config.localPath, 'installed.json');
    
    const registry = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      plugins: Array.from(this.installedPlugins.values()).map(p => ({
        name: p.name,
        version: p.version,
        installPath: p.installPath,
        installedAt: p.installedAt
      }))
    };
    
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  }
  
  async loadMarketplaceCache() {
    const cachePath = path.join(this.config.localPath, 'cache.json');
    
    if (fs.existsSync(cachePath)) {
      try {
        const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        
        for (const [key, value] of Object.entries(cacheData)) {
          this.cache.set(key, value);
        }
      } catch (error) {
        console.warn('Failed to load marketplace cache:', error.message);
      }
    }
  }
  
  async saveMarketplaceCache() {
    const cachePath = path.join(this.config.localPath, 'cache.json');
    const cacheData = Object.fromEntries(this.cache);
    
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
  }
}

// Global marketplace instance
let globalMarketplace = null;

// Comandos CLI para marketplace
const marketplaceCommands = {
  'marketplace:init': {
    description: 'Initialize plugin marketplace',
    handler: async (args) => {
      const { registry, localPath = './plugins' } = args;
      
      globalMarketplace = new PluginMarketplace({
        registryUrl: registry,
        localPath
      });
      
      console.log('🏪 Marketplace initialized');
      console.log(`   Local Path: ${localPath}`);
      if (registry) {
        console.log(`   Registry: ${registry}`);
      }
      
      return globalMarketplace;
    }
  },
  
  'marketplace:search': {
    description: 'Search plugins in marketplace',
    handler: async (args) => {
      if (!globalMarketplace) {
        console.error('❌ Marketplace not initialized. Run "marketplace:init" first.');
        return;
      }
      
      const { query = '', category, tags, publisher } = args;
      const results = await globalMarketplace.searchPlugins(query, { category, tags, publisher });
      
      if (results.length === 0) {
        console.log('📦 No plugins found');
        return [];
      }
      
      console.log(`🔍 Found ${results.length} plugins:`);
      console.log('');
      
      results.forEach(plugin => {
        const stars = '★'.repeat(Math.floor(plugin.rating));
        const installed = globalMarketplace.installedPlugins.has(plugin.name) ? '✅' : '';
        
        console.log(`${installed} ${plugin.name}@${plugin.version} ${stars}`);
        console.log(`   ${plugin.description}`);
        console.log(`   Publisher: ${plugin.publisher} | Downloads: ${plugin.downloads.toLocaleString()}`);
        console.log(`   Category: ${plugin.category} | Tags: ${plugin.tags.join(', ')}`);
        console.log('');
      });
      
      return results;
    }
  },
  
  'marketplace:install': {
    description: 'Install plugin from marketplace',
    handler: async (args) => {
      if (!globalMarketplace) {
        console.error('❌ Marketplace not initialized');
        return;
      }
      
      const { plugin, version, force } = args;
      
      if (!plugin) {
        console.error('❌ Plugin name required');
        return;
      }
      
      try {
        const result = await globalMarketplace.installPlugin(plugin, { version, force });
        console.log(`🎉 Installation completed successfully!`);
        return result;
      } catch (error) {
        console.error(`❌ Installation failed: ${error.message}`);
        throw error;
      }
    }
  },
  
  'marketplace:uninstall': {
    description: 'Uninstall plugin',
    handler: async (args) => {
      if (!globalMarketplace) {
        console.error('❌ Marketplace not initialized');
        return;
      }
      
      const { plugin, removeData } = args;
      
      if (!plugin) {
        console.error('❌ Plugin name required');
        return;
      }
      
      try {
        await globalMarketplace.uninstallPlugin(plugin, { removeData });
        return true;
      } catch (error) {
        console.error(`❌ Uninstall failed: ${error.message}`);
        throw error;
      }
    }
  },
  
  'marketplace:list': {
    description: 'List installed plugins',
    handler: async () => {
      if (!globalMarketplace) {
        console.error('❌ Marketplace not initialized');
        return;
      }
      
      const installed = globalMarketplace.listInstalled();
      
      if (installed.length === 0) {
        console.log('📦 No plugins installed');
        return [];
      }
      
      console.log(`📦 Installed Plugins (${installed.length}):`);\n      console.log('');
      
      installed.forEach(plugin => {
        console.log(`✅ ${plugin.name}@${plugin.version}`);
        console.log(`   Installed: ${new Date(plugin.installedAt).toLocaleString()}`);
        console.log(`   Path: ${plugin.installPath}`);
        console.log('');
      });
      
      return installed;
    }
  },
  
  'marketplace:update': {
    description: 'Update plugin or check for updates',
    handler: async (args) => {
      if (!globalMarketplace) {
        console.error('❌ Marketplace not initialized');
        return;
      }
      
      const { plugin, all, check } = args;
      
      if (check) {
        const updates = await globalMarketplace.checkUpdates();
        
        if (updates.length === 0) {
          console.log('✅ All plugins are up to date');
          return [];
        }
        
        console.log(`📦 ${updates.length} updates available:`);
        console.log('');
        
        updates.forEach(update => {
          console.log(`📦 ${update.name}: ${update.currentVersion} → ${update.latestVersion}`);
          console.log(`   ${update.description}`);
          console.log('');
        });
        
        return updates;
      }
      
      if (all) {
        const results = await globalMarketplace.updateAll();
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success);
        
        console.log(`✅ Updated ${successful} plugins`);
        
        if (failed.length > 0) {
          console.log(`❌ Failed to update ${failed.length} plugins:`);
          failed.forEach(f => console.log(`   ${f.name}: ${f.error}`));
        }
        
        return results;
      }
      
      if (plugin) {
        try {
          await globalMarketplace.updatePlugin(plugin);
          return true;
        } catch (error) {
          console.error(`❌ Update failed: ${error.message}`);
          throw error;
        }
      }
      
      console.error('❌ Specify --plugin <name>, --all, or --check');
    }
  },
  
  'marketplace:info': {
    description: 'Show plugin information',
    handler: async (args) => {
      if (!globalMarketplace) {
        console.error('❌ Marketplace not initialized');
        return;
      }
      
      const { plugin } = args;
      
      if (!plugin) {
        console.error('❌ Plugin name required');
        return;
      }
      
      try {
        const info = await globalMarketplace.getPluginDetails(plugin);
        
        const stars = '★'.repeat(Math.floor(info.rating));
        const installedStatus = info.installed ? 
          (info.updateAvailable ? `✅ ${info.installedVersion} (Update available: ${info.version})` : `✅ ${info.installedVersion}`) : 
          '❌ Not installed';
        
        console.log(`📦 ${info.name}@${info.version}`);
        console.log(`   ${info.description}`);
        console.log('');
        console.log(`   Publisher: ${info.publisher}`);
        console.log(`   Category: ${info.category}`);
        console.log(`   License: ${info.license}`);
        console.log(`   Rating: ${stars} (${info.rating}/5.0)`);
        console.log(`   Downloads: ${info.downloads.toLocaleString()}`);
        console.log(`   Tags: ${info.tags.join(', ')}`);
        console.log(`   Homepage: ${info.homepage}`);
        console.log(`   Status: ${installedStatus}`);
        
        if (info.dependencies && info.dependencies.length > 0) {
          console.log(`   Dependencies: ${info.dependencies.join(', ')}`);
        }
        
        return info;
      } catch (error) {
        console.error(`❌ Failed to get plugin info: ${error.message}`);
        throw error;
      }
    }
  }
};

// Criar e exportar o módulo
const marketplaceModule = createModule('marketplace')
  .version('1.0.0')
  .description('Plugin marketplace with discovery, installation, versioning, and security management')
  
  // Comandos CLI
  .command('marketplace:init', marketplaceCommands['marketplace:init'])
  .command('marketplace:search', marketplaceCommands['marketplace:search'])
  .command('marketplace:install', marketplaceCommands['marketplace:install'])
  .command('marketplace:uninstall', marketplaceCommands['marketplace:uninstall'])
  .command('marketplace:list', marketplaceCommands['marketplace:list'])
  .command('marketplace:update', marketplaceCommands['marketplace:update'])
  .command('marketplace:info', marketplaceCommands['marketplace:info'])
  
  .build();

// Adicionar classes e utilitários ao módulo
marketplaceModule.PluginMarketplace = PluginMarketplace;
marketplaceModule.getGlobalMarketplace = () => globalMarketplace;
marketplaceModule.setGlobalMarketplace = (marketplace) => { globalMarketplace = marketplace; };

module.exports = marketplaceModule;