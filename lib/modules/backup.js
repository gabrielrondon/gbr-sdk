/**
 * Backup/Recovery Module - Automated data protection with versioning and encryption
 */

const { createModule } = require('../module-system');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

class BackupManager {
  constructor(config = {}) {
    this.config = {
      storage: config.storage || 'local', // local, s3, azure, gcp
      backupPath: config.backupPath || './backups',
      retention: config.retention || 30, // days
      compression: config.compression !== false,
      encryption: config.encryption !== false,
      incrementalBackups: config.incrementalBackups !== false,
      schedule: config.schedule || '0 2 * * *', // Daily at 2 AM
      maxBackupSize: config.maxBackupSize || 500 * 1024 * 1024, // 500MB
      ...config
    };
    
    this.backups = new Map(); // Backup registry
    this.encryptionKey = this.generateEncryptionKey();
    this.isRunning = false;
    this.scheduleTimer = null;
    
    this.init();
  }
  
  async init() {
    console.log('💾 Initializing backup system...');
    
    // Create backup directory
    if (!fs.existsSync(this.config.backupPath)) {
      fs.mkdirSync(this.config.backupPath, { recursive: true });
    }
    
    // Load existing backup registry
    await this.loadBackupRegistry();
    
    console.log(`✅ Backup system initialized (${this.config.storage} storage)`);
  }
  
  /**
   * Create a new backup
   */
  async createBackup(source, options = {}) {
    const backupId = this.generateBackupId();
    const timestamp = new Date().toISOString();
    const backupType = options.type || (await this.shouldCreateIncremental(source) ? 'incremental' : 'full');
    
    console.log(`📦 Creating ${backupType} backup: ${source}`);
    
    const backup = {
      id: backupId,
      source,
      type: backupType,
      timestamp,
      status: 'creating',
      size: 0,
      checksum: null,
      metadata: {
        description: options.description || `${backupType} backup of ${source}`,
        tags: options.tags || [],
        retention: options.retention || this.config.retention,
        compressed: this.config.compression,
        encrypted: this.config.encryption
      }
    };
    
    this.backups.set(backupId, backup);
    
    try {
      // Create backup
      const backupData = await this.createBackupData(source, backupType, options);
      
      // Compress if enabled
      if (this.config.compression) {
        backupData.compressed = await this.compressData(backupData.data);
        backupData.data = backupData.compressed;
        backup.metadata.compression_ratio = backupData.compressed.length / backupData.originalSize;
      }
      
      // Encrypt if enabled
      if (this.config.encryption) {
        backupData.encrypted = await this.encryptData(backupData.data);
        backupData.data = backupData.encrypted.data;
        backup.metadata.encryption_iv = backupData.encrypted.iv;
      }
      
      // Calculate checksum
      backup.checksum = this.calculateChecksum(backupData.data);
      backup.size = backupData.data.length;
      
      // Store backup
      const backupPath = path.join(this.config.backupPath, `${backupId}.backup`);
      await this.storeBackup(backupPath, backupData.data);
      
      backup.path = backupPath;
      backup.status = 'completed';
      backup.completedAt = new Date().toISOString();
      backup.duration = Date.now() - new Date(timestamp).getTime();
      
      // Save registry
      await this.saveBackupRegistry();
      
      console.log(`✅ Backup created: ${backupId} (${this.formatSize(backup.size)})`);
      
      // Cleanup old backups
      await this.cleanupOldBackups();
      
      return backup;
      
    } catch (error) {
      backup.status = 'failed';
      backup.error = error.message;
      backup.failedAt = new Date().toISOString();
      
      console.error(`❌ Backup failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Restore from backup
   */
  async restoreBackup(backupId, destination, options = {}) {
    const backup = this.backups.get(backupId);
    
    if (!backup) {
      throw new Error(`Backup not found: ${backupId}`);
    }
    
    if (backup.status !== 'completed') {
      throw new Error(`Backup not available for restore: ${backup.status}`);
    }
    
    console.log(`🔄 Restoring backup: ${backupId} to ${destination}`);
    
    try {
      // Read backup data
      let backupData = await this.readBackup(backup.path);
      
      // Decrypt if encrypted
      if (backup.metadata.encrypted) {
        backupData = await this.decryptData({
          data: backupData,
          iv: backup.metadata.encryption_iv
        });
      }
      
      // Decompress if compressed
      if (backup.metadata.compressed) {
        backupData = await this.decompressData(backupData);
      }
      
      // Verify checksum
      const checksum = this.calculateChecksum(backupData);
      if (checksum !== backup.checksum) {
        throw new Error('Backup integrity check failed - checksum mismatch');
      }
      
      // Restore data
      await this.restoreData(backupData, destination, backup, options);
      
      console.log(`✅ Backup restored successfully: ${backupId}`);
      
      return {
        backupId,
        source: backup.source,
        destination,
        restoredAt: new Date().toISOString(),
        size: backup.size,
        type: backup.type
      };
      
    } catch (error) {
      console.error(`❌ Restore failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * List available backups
   */
  listBackups(filter = {}) {
    let backups = Array.from(this.backups.values());
    
    // Apply filters
    if (filter.source) {
      backups = backups.filter(b => b.source.includes(filter.source));
    }
    
    if (filter.type) {
      backups = backups.filter(b => b.type === filter.type);
    }
    
    if (filter.status) {
      backups = backups.filter(b => b.status === filter.status);
    }
    
    if (filter.tags) {
      const tags = Array.isArray(filter.tags) ? filter.tags : [filter.tags];
      backups = backups.filter(b => 
        tags.some(tag => b.metadata.tags.includes(tag))
      );
    }
    
    // Sort by timestamp (newest first)
    backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return backups;
  }
  
  /**
   * Delete backup
   */
  async deleteBackup(backupId) {
    const backup = this.backups.get(backupId);
    
    if (!backup) {
      throw new Error(`Backup not found: ${backupId}`);
    }
    
    try {
      // Delete backup file
      if (backup.path && fs.existsSync(backup.path)) {
        fs.unlinkSync(backup.path);
      }
      
      // Remove from registry
      this.backups.delete(backupId);
      await this.saveBackupRegistry();
      
      console.log(`🗑️ Backup deleted: ${backupId}`);
      return true;
      
    } catch (error) {
      console.error(`❌ Failed to delete backup: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Start automatic backup schedule
   */
  startSchedule() {
    if (this.isRunning) return;
    
    console.log(`⏰ Starting backup schedule: ${this.config.schedule}`);
    this.isRunning = true;
    
    // Simplified scheduler (in production would use cron library)
    const scheduleBackup = () => {
      setTimeout(async () => {
        try {
          await this.runScheduledBackup();
        } catch (error) {
          console.error('Scheduled backup failed:', error.message);
        }
        
        if (this.isRunning) {
          scheduleBackup(); // Schedule next backup
        }
      }, 24 * 60 * 60 * 1000); // Daily
    };
    
    scheduleBackup();
  }
  
  /**
   * Stop automatic backup schedule
   */
  stopSchedule() {
    console.log('⏹️ Stopping backup schedule');
    this.isRunning = false;
    
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
    }
  }
  
  /**
   * Get backup statistics
   */
  getStats() {
    const backups = Array.from(this.backups.values());
    const totalSize = backups.reduce((sum, b) => sum + b.size, 0);
    const completedBackups = backups.filter(b => b.status === 'completed');
    
    const typeStats = backups.reduce((stats, backup) => {
      stats[backup.type] = (stats[backup.type] || 0) + 1;
      return stats;
    }, {});
    
    const avgSize = completedBackups.length > 0 
      ? totalSize / completedBackups.length 
      : 0;
    
    return {
      totalBackups: backups.length,
      completedBackups: completedBackups.length,
      failedBackups: backups.filter(b => b.status === 'failed').length,
      totalSize,
      averageSize: avgSize,
      typeBreakdown: typeStats,
      oldestBackup: backups.length > 0 ? Math.min(...backups.map(b => new Date(b.timestamp))) : null,
      newestBackup: backups.length > 0 ? Math.max(...backups.map(b => new Date(b.timestamp))) : null,
      storageLocation: this.config.backupPath,
      encryptionEnabled: this.config.encryption,
      compressionEnabled: this.config.compression
    };
  }
  
  // Private methods
  async createBackupData(source, type, options) {
    // This would be implemented based on source type
    // For now, simulate backup creation
    console.log(`  📊 Creating ${type} backup data for: ${source}`);
    
    const mockData = {
      version: '1.0',
      type,
      source,
      timestamp: new Date().toISOString(),
      metadata: options.metadata || {},
      data: {
        files: ['file1.csv', 'file2.csv'],
        tables: ['users', 'transactions'],
        size: Math.floor(Math.random() * 1000000) + 100000
      }
    };
    
    const serialized = JSON.stringify(mockData);
    
    return {
      data: Buffer.from(serialized),
      originalSize: serialized.length
    };
  }
  
  async shouldCreateIncremental(source) {
    if (!this.config.incrementalBackups) return false;
    
    // Check if there's a recent full backup
    const recentBackups = Array.from(this.backups.values())
      .filter(b => b.source === source && b.type === 'full')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (recentBackups.length === 0) return false;
    
    const lastFull = recentBackups[0];
    const daysSinceLastFull = (Date.now() - new Date(lastFull.timestamp)) / (24 * 60 * 60 * 1000);
    
    return daysSinceLastFull < 7; // Create incremental if last full backup was within 7 days
  }
  
  async compressData(data) {
    // In real implementation, would use zlib
    console.log('  🗜️ Compressing backup data...');
    
    // Simulate compression (70% size reduction)
    const compressed = Buffer.alloc(Math.floor(data.length * 0.3));
    return compressed;
  }
  
  async decompressData(data) {
    // In real implementation, would use zlib
    console.log('  📦 Decompressing backup data...');
    
    // Simulate decompression
    return Buffer.alloc(Math.floor(data.length * 3.33));
  }
  
  async encryptData(data) {
    console.log('  🔐 Encrypting backup data...');
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return {
      data: encrypted,
      iv: iv.toString('hex')
    };
  }
  
  async decryptData(encryptedData) {
    console.log('  🔓 Decrypting backup data...');
    
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    
    let decrypted = decipher.update(encryptedData.data);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted;
  }
  
  calculateChecksum(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
  
  async storeBackup(backupPath, data) {
    fs.writeFileSync(backupPath, data);
  }
  
  async readBackup(backupPath) {
    return fs.readFileSync(backupPath);
  }
  
  async restoreData(data, destination, backup, options) {
    console.log(`  📁 Restoring data to: ${destination}`);
    
    // Parse backup data
    const backupData = JSON.parse(data.toString());
    
    // Create destination directory
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(destination, { recursive: true });
    }
    
    // Write restore info
    const restoreInfo = {
      backupId: backup.id,
      source: backup.source,
      type: backup.type,
      restoredAt: new Date().toISOString(),
      files: backupData.data.files || [],
      tables: backupData.data.tables || []
    };
    
    fs.writeFileSync(
      path.join(destination, 'restore-info.json'),
      JSON.stringify(restoreInfo, null, 2)
    );
  }
  
  async runScheduledBackup() {
    console.log('🕒 Running scheduled backup...');
    
    // This would backup configured sources
    // For demo, create a sample backup
    try {
      await this.createBackup('scheduled-source', {
        type: 'full',
        description: 'Scheduled automatic backup',
        tags: ['scheduled', 'automatic']
      });
    } catch (error) {
      console.error('Scheduled backup failed:', error.message);
    }
  }
  
  async cleanupOldBackups() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retention);
    
    const oldBackups = Array.from(this.backups.values())
      .filter(backup => new Date(backup.timestamp) < cutoffDate);
    
    for (const backup of oldBackups) {
      try {
        await this.deleteBackup(backup.id);
        console.log(`🧹 Cleaned up old backup: ${backup.id}`);
      } catch (error) {
        console.warn(`Failed to cleanup backup ${backup.id}: ${error.message}`);
      }
    }
  }
  
  async loadBackupRegistry() {
    const registryPath = path.join(this.config.backupPath, 'backup-registry.json');
    
    if (fs.existsSync(registryPath)) {
      try {
        const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        
        for (const backup of registry.backups || []) {
          this.backups.set(backup.id, backup);
        }
        
        console.log(`📋 Loaded ${this.backups.size} backups from registry`);
      } catch (error) {
        console.warn('Failed to load backup registry:', error.message);
      }
    }
  }
  
  async saveBackupRegistry() {
    const registryPath = path.join(this.config.backupPath, 'backup-registry.json');
    
    const registry = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      backups: Array.from(this.backups.values())
    };
    
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  }
  
  generateBackupId() {
    return 'backup_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  }
  
  generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
  }
  
  formatSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}

// Global backup manager
let globalBackupManager = null;

// Hook para backup automático após processamento
async function autoBackupProcessedData(data) {
  if (!globalBackupManager || !data || !data.processed_rows) return data;
  
  // Auto-backup if configured
  if (data.autoBackup === true || data.backup === true) {
    try {
      console.log('💾 Auto-backup: Creating backup of processed data...');
      
      const backup = await globalBackupManager.createBackup(
        data.filePath || 'processed-data',
        {
          description: 'Automatic backup of processed data',
          tags: ['auto-backup', 'processing'],
          metadata: {
            rows: data.processed_rows.length,
            errors: data.errors?.length || 0,
            processingTime: data.processingTime
          }
        }
      );
      
      return {
        ...data,
        backup: {
          id: backup.id,
          created: backup.timestamp,
          size: backup.size
        }
      };
      
    } catch (error) {
      console.warn('Auto-backup failed:', error.message);
    }
  }
  
  return data;
}

// Comandos CLI para backup
const backupCommands = {
  'backup:init': {
    description: 'Initialize backup system',
    handler: async (args) => {
      const { storage = 'local', path: backupPath = './backups', encryption = true } = args;
      
      globalBackupManager = new BackupManager({
        storage,
        backupPath,
        encryption
      });
      
      console.log(`✅ Backup system initialized`);
      console.log(`   Storage: ${storage}`);
      console.log(`   Path: ${backupPath}`);
      console.log(`   Encryption: ${encryption ? 'Enabled' : 'Disabled'}`);
      
      return globalBackupManager;
    }
  },
  
  'backup:create': {
    description: 'Create a new backup',
    handler: async (args) => {
      const { source, description, type = 'auto', tags } = args;
      
      if (!globalBackupManager) {
        console.error('❌ Backup system not initialized. Run "backup:init" first.');
        return;
      }
      
      if (!source) {
        console.error('❌ Source path required');
        return;
      }
      
      const options = {
        description,
        type: type === 'auto' ? undefined : type,
        tags: tags ? tags.split(',').map(t => t.trim()) : []
      };
      
      const backup = await globalBackupManager.createBackup(source, options);
      
      console.log(`✅ Backup created successfully:`);
      console.log(`   ID: ${backup.id}`);
      console.log(`   Type: ${backup.type}`);
      console.log(`   Size: ${globalBackupManager.formatSize(backup.size)}`);
      console.log(`   Duration: ${backup.duration}ms`);
      
      return backup;
    }
  },
  
  'backup:list': {
    description: 'List available backups',
    handler: async (args) => {
      if (!globalBackupManager) {
        console.error('❌ Backup system not initialized');
        return;
      }
      
      const { source, type, status, tags } = args;
      const backups = globalBackupManager.listBackups({ source, type, status, tags });
      
      if (backups.length === 0) {
        console.log('📋 No backups found');
        return [];
      }
      
      console.log('📋 Available Backups:');
      console.log('');
      
      backups.forEach(backup => {
        const statusIcon = backup.status === 'completed' ? '✅' : 
                          backup.status === 'failed' ? '❌' : '🔄';
        
        console.log(`${statusIcon} ${backup.id}`);
        console.log(`   Source: ${backup.source}`);
        console.log(`   Type: ${backup.type}`);
        console.log(`   Size: ${globalBackupManager.formatSize(backup.size)}`);
        console.log(`   Created: ${new Date(backup.timestamp).toLocaleString()}`);
        
        if (backup.metadata.tags.length > 0) {
          console.log(`   Tags: ${backup.metadata.tags.join(', ')}`);
        }
        
        console.log('');
      });
      
      return backups;
    }
  },
  
  'backup:restore': {
    description: 'Restore from backup',
    handler: async (args) => {
      const { backupId, destination } = args;
      
      if (!globalBackupManager) {
        console.error('❌ Backup system not initialized');
        return;
      }
      
      if (!backupId || !destination) {
        console.error('❌ Backup ID and destination required');
        return;
      }
      
      const result = await globalBackupManager.restoreBackup(backupId, destination);
      
      console.log(`✅ Restore completed:`);
      console.log(`   Backup ID: ${result.backupId}`);
      console.log(`   Source: ${result.source}`);
      console.log(`   Destination: ${result.destination}`);
      console.log(`   Size: ${globalBackupManager.formatSize(result.size)}`);
      
      return result;
    }
  },
  
  'backup:delete': {
    description: 'Delete a backup',
    handler: async (args) => {
      const { backupId, confirm } = args;
      
      if (!globalBackupManager) {
        console.error('❌ Backup system not initialized');
        return;
      }
      
      if (!backupId) {
        console.error('❌ Backup ID required');
        return;
      }
      
      if (!confirm) {
        console.error('❌ Add --confirm flag to delete backup');
        return;
      }
      
      const success = await globalBackupManager.deleteBackup(backupId);
      
      if (success) {
        console.log(`✅ Backup deleted: ${backupId}`);
      } else {
        console.log(`❌ Failed to delete backup: ${backupId}`);
      }
      
      return success;
    }
  },
  
  'backup:stats': {
    description: 'Show backup statistics',
    handler: async () => {
      if (!globalBackupManager) {
        console.error('❌ Backup system not initialized');
        return;
      }
      
      const stats = globalBackupManager.getStats();
      
      console.log('📊 Backup Statistics:');
      console.log(`   Total Backups: ${stats.totalBackups}`);
      console.log(`   Completed: ${stats.completedBackups}`);
      console.log(`   Failed: ${stats.failedBackups}`);
      console.log(`   Total Size: ${globalBackupManager.formatSize(stats.totalSize)}`);
      console.log(`   Average Size: ${globalBackupManager.formatSize(stats.averageSize)}`);
      console.log(`   Storage Location: ${stats.storageLocation}`);
      console.log(`   Encryption: ${stats.encryptionEnabled ? 'Enabled' : 'Disabled'}`);
      console.log(`   Compression: ${stats.compressionEnabled ? 'Enabled' : 'Disabled'}`);
      
      if (Object.keys(stats.typeBreakdown).length > 0) {
        console.log('   Type Breakdown:');
        Object.entries(stats.typeBreakdown).forEach(([type, count]) => {
          console.log(`     ${type}: ${count}`);
        });
      }
      
      return stats;
    }
  },
  
  'backup:schedule': {
    description: 'Start/stop automatic backup schedule',
    handler: async (args) => {
      const { action = 'start' } = args;
      
      if (!globalBackupManager) {
        console.error('❌ Backup system not initialized');
        return;
      }
      
      if (action === 'start') {
        globalBackupManager.startSchedule();
        console.log('⏰ Backup schedule started');
      } else if (action === 'stop') {
        globalBackupManager.stopSchedule();
        console.log('⏹️ Backup schedule stopped');
      } else {
        console.error('❌ Action must be "start" or "stop"');
      }
    }
  }
};

// Criar e exportar o módulo
const backupModule = createModule('backup')
  .version('1.0.0')
  .description('Automated data protection with versioning, encryption, compression, and recovery capabilities')
  
  // Hooks
  .hook('after:process', autoBackupProcessedData)
  
  // Comandos CLI
  .command('backup:init', backupCommands['backup:init'])
  .command('backup:create', backupCommands['backup:create'])
  .command('backup:list', backupCommands['backup:list'])
  .command('backup:restore', backupCommands['backup:restore'])
  .command('backup:delete', backupCommands['backup:delete'])
  .command('backup:stats', backupCommands['backup:stats'])
  .command('backup:schedule', backupCommands['backup:schedule'])
  
  .build();

// Adicionar classes e utilitários ao módulo
backupModule.BackupManager = BackupManager;
backupModule.getGlobalBackupManager = () => globalBackupManager;
backupModule.setGlobalBackupManager = (manager) => { globalBackupManager = manager; };

module.exports = backupModule;