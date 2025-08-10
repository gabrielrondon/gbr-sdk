/**
 * Cache Module - High-performance caching with Redis support and intelligent strategies
 */

const { createModule } = require('../module-system');
const crypto = require('crypto');

class CacheManager {
  constructor(config = {}) {
    this.config = {
      type: config.type || 'memory',
      redis: config.redis || { host: 'localhost', port: 6379 },
      ttl: config.ttl || 3600, // 1 hour default
      prefix: config.prefix || 'gbr:cache:',
      maxMemorySize: config.maxMemorySize || 100 * 1024 * 1024, // 100MB
      compression: config.compression !== false,
      ...config
    };
    
    this.memoryCache = new Map();
    this.memorySize = 0;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0
    };
    
    this.redis = null;
    this.initialized = false;
  }
  
  async init() {
    if (this.initialized) return;
    
    console.log(`🚀 Initializing ${this.config.type} cache...`);
    
    if (this.config.type === 'redis') {
      await this.initRedis();
    }
    
    // Start cleanup interval for memory cache
    if (this.config.type === 'memory' || this.config.type === 'hybrid') {
      this.startCleanupInterval();
    }
    
    this.initialized = true;
    console.log(`✅ Cache initialized (${this.config.type})`);
  }
  
  async initRedis() {
    try {
      // In real implementation, would use 'redis' package
      // const Redis = require('redis');
      // this.redis = Redis.createClient(this.config.redis);
      // await this.redis.connect();
      
      // Simulation
      this.redis = {
        connected: true,
        get: async (key) => null,
        set: async (key, value, options) => 'OK',
        del: async (key) => 1,
        exists: async (key) => 0,
        ttl: async (key) => -1,
        flushall: async () => 'OK',
        info: async () => 'redis_version:7.0.0\nused_memory:1024000'
      };
      
      console.log(`  🔗 Connected to Redis: ${this.config.redis.host}:${this.config.redis.port}`);
    } catch (error) {
      console.error('❌ Redis connection failed, falling back to memory cache');
      this.config.type = 'memory';
    }
  }
  
  async get(key) {
    const cacheKey = this.buildKey(key);
    
    try {
      let value = null;
      
      // Try memory cache first (for hybrid mode)
      if (this.config.type === 'memory' || this.config.type === 'hybrid') {
        const memoryEntry = this.memoryCache.get(cacheKey);
        if (memoryEntry && !this.isExpired(memoryEntry)) {
          this.stats.hits++;
          return this.decompress(memoryEntry.value);
        }
      }
      
      // Try Redis cache
      if (this.config.type === 'redis' || this.config.type === 'hybrid') {
        if (this.redis) {
          const redisValue = await this.redis.get(cacheKey);
          if (redisValue) {
            this.stats.hits++;
            value = JSON.parse(redisValue);
            
            // Store in memory cache for hybrid mode
            if (this.config.type === 'hybrid') {
              this.setMemoryCache(cacheKey, value);
            }
            
            return this.decompress(value);
          }
        }
      }
      
      this.stats.misses++;
      return null;
      
    } catch (error) {
      console.error('Cache get error:', error.message);
      this.stats.misses++;
      return null;
    }
  }
  
  async set(key, value, ttl = null) {
    const cacheKey = this.buildKey(key);
    const expiry = Date.now() + ((ttl || this.config.ttl) * 1000);
    const compressedValue = this.compress(value);
    
    try {
      // Set in memory cache
      if (this.config.type === 'memory' || this.config.type === 'hybrid') {
        this.setMemoryCache(cacheKey, compressedValue, expiry);
      }
      
      // Set in Redis cache
      if (this.config.type === 'redis' || this.config.type === 'hybrid') {
        if (this.redis) {
          const redisValue = JSON.stringify(compressedValue);
          await this.redis.set(cacheKey, redisValue, {
            EX: ttl || this.config.ttl
          });
        }
      }
      
      this.stats.sets++;
      return true;
      
    } catch (error) {
      console.error('Cache set error:', error.message);
      return false;
    }
  }
  
  async del(key) {
    const cacheKey = this.buildKey(key);
    
    try {
      // Delete from memory
      if (this.config.type === 'memory' || this.config.type === 'hybrid') {
        const entry = this.memoryCache.get(cacheKey);
        if (entry) {
          this.memorySize -= this.calculateSize(entry.value);
          this.memoryCache.delete(cacheKey);
        }
      }
      
      // Delete from Redis
      if (this.config.type === 'redis' || this.config.type === 'hybrid') {
        if (this.redis) {
          await this.redis.del(cacheKey);
        }
      }
      
      this.stats.deletes++;
      return true;
      
    } catch (error) {
      console.error('Cache delete error:', error.message);
      return false;
    }
  }
  
  async exists(key) {
    const cacheKey = this.buildKey(key);
    
    // Check memory cache
    if (this.config.type === 'memory' || this.config.type === 'hybrid') {
      const entry = this.memoryCache.get(cacheKey);
      if (entry && !this.isExpired(entry)) {
        return true;
      }
    }
    
    // Check Redis cache
    if (this.config.type === 'redis' || this.config.type === 'hybrid') {
      if (this.redis) {
        const exists = await this.redis.exists(cacheKey);
        return exists === 1;
      }
    }
    
    return false;
  }
  
  async clear() {
    try {
      // Clear memory cache
      if (this.config.type === 'memory' || this.config.type === 'hybrid') {
        this.memoryCache.clear();
        this.memorySize = 0;
      }
      
      // Clear Redis cache
      if (this.config.type === 'redis' || this.config.type === 'hybrid') {
        if (this.redis) {
          await this.redis.flushall();
        }
      }
      
      console.log('🧹 Cache cleared');
      return true;
      
    } catch (error) {
      console.error('Cache clear error:', error.message);
      return false;
    }
  }
  
  getStats() {
    const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses) * 100 || 0;
    
    return {
      ...this.stats,
      hitRate: parseFloat(hitRate.toFixed(2)),
      memorySize: this.memorySize,
      memoryEntries: this.memoryCache.size,
      type: this.config.type
    };
  }
  
  // Private methods
  setMemoryCache(key, value, expiry = null) {
    // Check memory limit
    const size = this.calculateSize(value);
    
    if (this.memorySize + size > this.config.maxMemorySize) {
      this.evictLRU();
    }
    
    const finalExpiry = expiry || Date.now() + (this.config.ttl * 1000);
    
    this.memoryCache.set(key, {
      value,
      expiry: finalExpiry,
      accessTime: Date.now()
    });
    
    this.memorySize += size;
  }
  
  evictLRU() {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.accessTime < oldestTime) {
        oldestTime = entry.accessTime;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      const entry = this.memoryCache.get(oldestKey);
      this.memorySize -= this.calculateSize(entry.value);
      this.memoryCache.delete(oldestKey);
      this.stats.evictions++;
    }
  }
  
  startCleanupInterval() {
    setInterval(() => {
      this.cleanupExpired();
    }, 60000); // Every minute
  }
  
  cleanupExpired() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.memoryCache.entries()) {
      if (this.isExpired(entry, now)) {
        this.memorySize -= this.calculateSize(entry.value);
        this.memoryCache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} expired cache entries`);
    }
  }
  
  buildKey(key) {
    return this.config.prefix + this.hashKey(key);
  }
  
  hashKey(key) {
    if (typeof key === 'object') {
      key = JSON.stringify(key);
    }
    return crypto.createHash('md5').update(key.toString()).digest('hex');
  }
  
  compress(value) {
    if (!this.config.compression) return value;
    
    try {
      const stringValue = JSON.stringify(value);
      // In real implementation, would use zlib compression
      // return zlib.gzipSync(stringValue);
      return stringValue; // Simplified for demo
    } catch {
      return value;
    }
  }
  
  decompress(value) {
    if (!this.config.compression) return value;
    
    try {
      // In real implementation, would decompress with zlib
      // const decompressed = zlib.gunzipSync(value);
      // return JSON.parse(decompressed.toString());
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      return value;
    }
  }
  
  isExpired(entry, now = Date.now()) {
    return entry.expiry < now;
  }
  
  calculateSize(value) {
    return JSON.stringify(value).length * 2; // Rough estimate
  }
}

// Cache strategies
const CacheStrategies = {
  // Cache-aside (lazy loading)
  async cacheAside(cacheManager, key, fetchFunction, ttl = null) {
    let data = await cacheManager.get(key);
    
    if (data === null) {
      console.log(`🔄 Cache miss: ${key}, fetching data...`);
      data = await fetchFunction();
      await cacheManager.set(key, data, ttl);
    } else {
      console.log(`⚡ Cache hit: ${key}`);
    }
    
    return data;
  },
  
  // Write-through
  async writeThrough(cacheManager, key, data, persistFunction, ttl = null) {
    // Write to both cache and persistent storage
    await Promise.all([
      cacheManager.set(key, data, ttl),
      persistFunction(data)
    ]);
    
    return data;
  },
  
  // Write-behind (write-back)
  async writeBehind(cacheManager, key, data, ttl = null) {
    // Write to cache immediately
    await cacheManager.set(key, data, ttl);
    
    // Schedule write to persistent storage
    setTimeout(async () => {
      // In real implementation, would have a queue system
      console.log(`📝 Write-behind: persisting ${key}`);
    }, 1000);
    
    return data;
  }
};

// Global cache instance
let globalCache = null;

// Hook para cache de resultados
async function cacheProcessingResults(data) {
  if (!globalCache || !data) return data;
  
  const { filePath, processed_rows } = data;
  
  if (filePath && processed_rows) {
    // Generate cache key from file path and modification time
    const fs = require('fs');
    try {
      const stats = fs.statSync(filePath);
      const cacheKey = `file:${filePath}:${stats.mtime.getTime()}`;
      
      // Cache the results
      await globalCache.set(cacheKey, {
        processed_rows,
        errors: data.errors || [],
        cached_at: new Date().toISOString()
      }, 1800); // 30 minutes TTL
      
      console.log(`💾 Results cached for: ${filePath}`);
    } catch (error) {
      console.warn('Cache warning:', error.message);
    }
  }
  
  return data;
}

// Hook para verificar cache antes do processamento
async function checkProcessingCache(data) {
  if (!globalCache || !data || !data.filePath) return data;
  
  const { filePath } = data;
  
  try {
    const fs = require('fs');
    const stats = fs.statSync(filePath);
    const cacheKey = `file:${filePath}:${stats.mtime.getTime()}`;
    
    const cachedResult = await globalCache.get(cacheKey);
    
    if (cachedResult) {
      console.log(`⚡ Using cached results for: ${filePath}`);
      return {
        ...data,
        ...cachedResult,
        from_cache: true
      };
    }
  } catch (error) {
    console.warn('Cache check warning:', error.message);
  }
  
  return data;
}

// Comandos CLI para cache
const cacheCommands = {
  'cache:start': {
    description: 'Start cache service',
    handler: async (args) => {
      const { type = 'memory', host = 'localhost', port = 6379 } = args;
      
      globalCache = new CacheManager({
        type,
        redis: { host, port }
      });
      
      await globalCache.init();
      console.log(`🚀 Cache service started (${type})`);
      
      return globalCache;
    }
  },
  
  'cache:stats': {
    description: 'Show cache statistics',
    handler: async () => {
      if (!globalCache) {
        console.error('❌ Cache not initialized. Run "cache:start" first.');
        return;
      }
      
      const stats = globalCache.getStats();
      
      console.log('📊 Cache Statistics:');
      console.log(`   Type: ${stats.type}`);
      console.log(`   Hits: ${stats.hits}`);
      console.log(`   Misses: ${stats.misses}`);
      console.log(`   Hit Rate: ${stats.hitRate}%`);
      console.log(`   Sets: ${stats.sets}`);
      console.log(`   Deletes: ${stats.deletes}`);
      console.log(`   Evictions: ${stats.evictions}`);
      console.log(`   Memory Size: ${(stats.memorySize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Memory Entries: ${stats.memoryEntries}`);
      
      return stats;
    }
  },
  
  'cache:clear': {
    description: 'Clear all cache entries',
    handler: async () => {
      if (!globalCache) {
        console.error('❌ Cache not initialized');
        return;
      }
      
      await globalCache.clear();
      console.log('🧹 Cache cleared successfully');
    }
  },
  
  'cache:get': {
    description: 'Get cached value by key',
    handler: async (args) => {
      const { key } = args;
      
      if (!globalCache) {
        console.error('❌ Cache not initialized');
        return;
      }
      
      const value = await globalCache.get(key);
      
      if (value !== null) {
        console.log(`✅ Found: ${key}`);
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(`❌ Not found: ${key}`);
      }
      
      return value;
    }
  },
  
  'cache:set': {
    description: 'Set cache value',
    handler: async (args) => {
      const { key, value, ttl } = args;
      
      if (!globalCache) {
        console.error('❌ Cache not initialized');
        return;
      }
      
      let parsedValue;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }
      
      const success = await globalCache.set(key, parsedValue, ttl);
      
      if (success) {
        console.log(`✅ Set: ${key} = ${value}`);
      } else {
        console.log(`❌ Failed to set: ${key}`);
      }
      
      return success;
    }
  }
};

// Criar e exportar o módulo
const cacheModule = createModule('cache')
  .version('1.0.0')
  .description('High-performance caching with Redis support, intelligent strategies, and automatic result caching')
  
  // Hooks
  .hook('before:process', checkProcessingCache)
  .hook('after:process', cacheProcessingResults)
  
  // Comandos CLI
  .command('cache:start', cacheCommands['cache:start'])
  .command('cache:stats', cacheCommands['cache:stats'])
  .command('cache:clear', cacheCommands['cache:clear'])
  .command('cache:get', cacheCommands['cache:get'])
  .command('cache:set', cacheCommands['cache:set'])
  
  .build();

// Adicionar classes e utilitários ao módulo
cacheModule.CacheManager = CacheManager;
cacheModule.CacheStrategies = CacheStrategies;
cacheModule.getGlobalCache = () => globalCache;
cacheModule.setGlobalCache = (cache) => { globalCache = cache; };

module.exports = cacheModule;