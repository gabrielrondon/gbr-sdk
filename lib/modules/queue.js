/**
 * Queue Module - Asynchronous job processing with priority, retries, and scalable workers
 */

const { createModule } = require('../module-system');
const { EventEmitter } = require('events');
const crypto = require('crypto');

class JobQueue extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      name: config.name || 'default',
      redis: config.redis || { host: 'localhost', port: 6379 },
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 5000,
      concurrency: config.concurrency || 4,
      timeout: config.timeout || 300000, // 5 minutes
      cleanupInterval: config.cleanupInterval || 3600000, // 1 hour
      ...config
    };
    
    this.jobs = new Map(); // In-memory job storage (Redis simulation)
    this.workers = new Map();
    this.processors = new Map();
    this.stats = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      activeJobs: 0,
      waitingJobs: 0,
      delayedJobs: 0
    };
    
    this.isRunning = false;
    this.cleanupTimer = null;
    
    this.init();
  }
  
  init() {
    console.log(`🚀 Initializing job queue: ${this.config.name}`);
    
    // Start cleanup timer
    this.startCleanup();
    
    // Handle graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }
  
  /**
   * Add job to queue
   */
  async add(jobType, data, options = {}) {
    const job = {
      id: this.generateJobId(),
      type: jobType,
      data,
      priority: options.priority || 0,
      delay: options.delay || 0,
      maxRetries: options.maxRetries || this.config.maxRetries,
      timeout: options.timeout || this.config.timeout,
      status: 'waiting',
      attempts: 0,
      createdAt: Date.now(),
      processAt: Date.now() + (options.delay || 0),
      updatedAt: Date.now(),
      result: null,
      error: null,
      progress: 0,
      logs: []
    };
    
    this.jobs.set(job.id, job);
    this.stats.totalJobs++;
    this.stats.waitingJobs++;
    
    if (job.delay > 0) {
      this.stats.delayedJobs++;
      setTimeout(() => {
        const currentJob = this.jobs.get(job.id);
        if (currentJob && currentJob.status === 'waiting') {
          this.stats.delayedJobs--;
          this.processNextJob();
        }
      }, job.delay);
    }
    
    console.log(`📋 Job added: ${job.type} (${job.id})`);
    this.emit('job:added', job);
    
    // Start processing if not running
    if (!this.isRunning) {
      this.start();
    }
    
    return job;
  }
  
  /**
   * Process jobs of a specific type
   */
  process(jobType, processor) {
    console.log(`⚙️ Registering processor for: ${jobType}`);
    this.processors.set(jobType, processor);
    
    // Start processing if not running
    if (!this.isRunning) {
      this.start();
    }
  }
  
  /**
   * Start processing jobs
   */
  start() {
    if (this.isRunning) return;
    
    console.log(`🚀 Starting job queue processing (${this.config.concurrency} workers)`);
    this.isRunning = true;
    
    // Start workers
    for (let i = 0; i < this.config.concurrency; i++) {
      this.startWorker(i);
    }
  }
  
  /**
   * Stop processing jobs
   */
  async stop() {
    console.log('🛑 Stopping job queue processing...');
    this.isRunning = false;
    
    // Wait for active jobs to complete
    const activeJobs = Array.from(this.jobs.values()).filter(job => job.status === 'active');
    
    if (activeJobs.length > 0) {
      console.log(`⏳ Waiting for ${activeJobs.length} active jobs to complete...`);
      
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const stillActive = Array.from(this.jobs.values()).filter(job => job.status === 'active');
          if (stillActive.length === 0) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 1000);
      });
    }
    
    console.log('✅ Job queue stopped');
  }
  
  /**
   * Shutdown gracefully
   */
  async shutdown() {
    console.log('🔄 Graceful shutdown initiated...');
    
    await this.stop();
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    console.log('👋 Queue shutdown complete');
    process.exit(0);
  }
  
  /**
   * Get job by ID
   */
  getJob(jobId) {
    return this.jobs.get(jobId);
  }
  
  /**
   * Get jobs by status
   */
  getJobs(status = null, limit = 50) {
    const jobs = Array.from(this.jobs.values());
    
    let filtered = status ? jobs.filter(job => job.status === status) : jobs;
    
    // Sort by priority (desc) then by creation time (asc)
    filtered.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.createdAt - b.createdAt;
    });
    
    return filtered.slice(0, limit);
  }
  
  /**
   * Remove job
   */
  async remove(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    
    if (job.status === 'active') {
      console.warn(`⚠️ Cannot remove active job: ${jobId}`);
      return false;
    }
    
    this.jobs.delete(jobId);
    this.updateStats();
    
    console.log(`🗑️ Job removed: ${jobId}`);
    this.emit('job:removed', job);
    
    return true;
  }
  
  /**
   * Clean completed and failed jobs
   */
  async clean(olderThan = 24 * 60 * 60 * 1000) { // 24 hours
    const cutoff = Date.now() - olderThan;
    let cleaned = 0;
    
    for (const [jobId, job] of this.jobs) {
      if ((job.status === 'completed' || job.status === 'failed') && 
          job.updatedAt < cutoff) {
        this.jobs.delete(jobId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} old jobs`);
      this.updateStats();
    }
    
    return cleaned;
  }
  
  /**
   * Get queue statistics
   */
  getStats() {
    this.updateStats();
    
    const jobs = Array.from(this.jobs.values());
    const processingTimes = jobs
      .filter(job => job.status === 'completed' && job.processingTime)
      .map(job => job.processingTime);
    
    const avgProcessingTime = processingTimes.length > 0 
      ? processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length
      : 0;
    
    return {
      ...this.stats,
      avgProcessingTime: Math.round(avgProcessingTime),
      totalJobsInMemory: this.jobs.size,
      isRunning: this.isRunning,
      workers: this.config.concurrency,
      processors: Array.from(this.processors.keys())
    };
  }
  
  // Private methods
  startWorker(workerId) {
    const worker = {
      id: workerId,
      status: 'idle',
      currentJob: null,
      processedJobs: 0,
      startedAt: Date.now()
    };
    
    this.workers.set(workerId, worker);
    
    // Worker loop
    const processLoop = async () => {
      while (this.isRunning) {
        try {
          const job = await this.getNextJob();
          
          if (job) {
            worker.status = 'busy';
            worker.currentJob = job.id;
            
            await this.executeJob(job, worker);
            
            worker.processedJobs++;
            worker.currentJob = null;
            worker.status = 'idle';
          } else {
            // No jobs available, wait a bit
            await this.sleep(1000);
          }
        } catch (error) {
          console.error(`Worker ${workerId} error:`, error.message);
          worker.status = 'idle';
          worker.currentJob = null;
          await this.sleep(5000);
        }
      }
    };
    
    processLoop();
    console.log(`👷 Worker ${workerId} started`);
  }
  
  async getNextJob() {
    const now = Date.now();
    
    // Find highest priority job that's ready to process
    let nextJob = null;
    let highestPriority = -Infinity;
    
    for (const job of this.jobs.values()) {
      if (job.status === 'waiting' && job.processAt <= now) {
        if (job.priority > highestPriority) {
          highestPriority = job.priority;
          nextJob = job;
        }
      }
    }
    
    if (nextJob) {
      nextJob.status = 'active';
      nextJob.startedAt = Date.now();
      nextJob.updatedAt = Date.now();
      
      this.stats.waitingJobs--;
      this.stats.activeJobs++;
      
      this.emit('job:started', nextJob);
    }
    
    return nextJob;
  }
  
  async executeJob(job, worker) {
    const processor = this.processors.get(job.type);
    
    if (!processor) {
      await this.failJob(job, new Error(`No processor found for job type: ${job.type}`));
      return;
    }
    
    try {
      console.log(`⚙️ Processing job: ${job.type} (${job.id}) by worker ${worker.id}`);
      
      // Create job context
      const jobContext = {
        id: job.id,
        type: job.type,
        data: job.data,
        attempts: job.attempts,
        log: (message) => this.logJob(job, message),
        progress: (percent) => this.updateJobProgress(job, percent)
      };
      
      // Execute with timeout
      const result = await Promise.race([
        processor(jobContext),
        this.createTimeout(job.timeout)
      ]);
      
      await this.completeJob(job, result);
      
    } catch (error) {
      console.error(`❌ Job failed: ${job.id} - ${error.message}`);
      
      // Retry if possible
      if (job.attempts < job.maxRetries) {
        await this.retryJob(job, error);
      } else {
        await this.failJob(job, error);
      }
    }
  }
  
  async completeJob(job, result) {
    job.status = 'completed';
    job.result = result;
    job.completedAt = Date.now();
    job.processingTime = job.completedAt - job.startedAt;
    job.updatedAt = Date.now();
    job.progress = 100;
    
    this.stats.activeJobs--;
    this.stats.completedJobs++;
    
    console.log(`✅ Job completed: ${job.id} (${job.processingTime}ms)`);
    this.emit('job:completed', job);
  }
  
  async failJob(job, error) {
    job.status = 'failed';
    job.error = error.message;
    job.failedAt = Date.now();
    job.processingTime = job.failedAt - job.startedAt;
    job.updatedAt = Date.now();
    
    this.stats.activeJobs--;
    this.stats.failedJobs++;
    
    console.log(`❌ Job failed permanently: ${job.id} - ${error.message}`);
    this.emit('job:failed', job);
  }
  
  async retryJob(job, error) {
    job.attempts++;
    job.status = 'waiting';
    job.processAt = Date.now() + (this.config.retryDelay * Math.pow(2, job.attempts - 1)); // Exponential backoff
    job.updatedAt = Date.now();
    job.error = error.message;
    
    this.stats.activeJobs--;
    this.stats.waitingJobs++;
    
    console.log(`🔄 Job retry scheduled: ${job.id} (attempt ${job.attempts}/${job.maxRetries})`);
    this.emit('job:retry', job);
    
    // Schedule retry
    setTimeout(() => {
      this.processNextJob();
    }, job.processAt - Date.now());
  }
  
  logJob(job, message) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      message
    };
    
    job.logs.push(logEntry);
    console.log(`📝 Job ${job.id}: ${message}`);
  }
  
  updateJobProgress(job, percent) {
    job.progress = Math.max(0, Math.min(100, percent));
    job.updatedAt = Date.now();
    
    this.emit('job:progress', job);
  }
  
  createTimeout(timeout) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Job timeout after ${timeout}ms`));
      }, timeout);
    });
  }
  
  processNextJob() {
    // Wake up idle workers
    setImmediate(() => {
      // Workers will pick up jobs in their loops
    });
  }
  
  updateStats() {
    const jobs = Array.from(this.jobs.values());
    
    this.stats.activeJobs = jobs.filter(j => j.status === 'active').length;
    this.stats.waitingJobs = jobs.filter(j => j.status === 'waiting').length;
    this.stats.delayedJobs = jobs.filter(j => j.status === 'waiting' && j.processAt > Date.now()).length;
    this.stats.completedJobs = jobs.filter(j => j.status === 'completed').length;
    this.stats.failedJobs = jobs.filter(j => j.status === 'failed').length;
  }
  
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.clean();
    }, this.config.cleanupInterval);
  }
  
  generateJobId() {
    return crypto.randomBytes(16).toString('hex');
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Global queue instances
const queues = new Map();

// Get or create queue
function getQueue(name = 'default', config = {}) {
  if (!queues.has(name)) {
    const queue = new JobQueue({ ...config, name });
    queues.set(name, queue);
  }
  return queues.get(name);
}

// CSV processing job processor
async function processCsvJob(job) {
  const { processCsv } = require('../../index');
  const { filePath, options = {} } = job.data;
  
  job.log(`Starting CSV processing: ${filePath}`);
  job.progress(10);
  
  try {
    const result = await processCsv(filePath);
    
    job.progress(90);
    job.log(`Processed ${result.processed_rows.length} rows with ${result.errors.length} errors`);
    
    job.progress(100);
    return {
      ...result,
      processedAt: new Date().toISOString(),
      jobId: job.id
    };
    
  } catch (error) {
    job.log(`Processing failed: ${error.message}`);
    throw error;
  }
}

// Hook para processamento assíncrono
async function processViaQueue(data) {
  if (data && data.async === true && data.filePath) {
    console.log('🔄 Processing file asynchronously via queue...');
    
    const queue = getQueue('csv-processing');
    
    // Register CSV processor if not already registered
    if (!queue.processors.has('process-csv')) {
      queue.process('process-csv', processCsvJob);
    }
    
    const job = await queue.add('process-csv', {
      filePath: data.filePath,
      options: data.options
    }, {
      priority: data.priority || 0
    });
    
    return {
      jobId: job.id,
      status: 'queued',
      message: 'File queued for asynchronous processing'
    };
  }
  
  return data;
}

// Comandos CLI para filas
const queueCommands = {
  'queue:start': {
    description: 'Start job queue processing',
    handler: async (args) => {
      const { name = 'default', workers = 4 } = args;
      
      const queue = getQueue(name, { concurrency: workers });
      queue.start();
      
      // Register default CSV processor
      queue.process('process-csv', processCsvJob);
      
      console.log(`🚀 Queue "${name}" started with ${workers} workers`);
      
      // Keep alive
      process.on('SIGINT', async () => {
        await queue.shutdown();
      });
    }
  },
  
  'queue:stats': {
    description: 'Show queue statistics',
    handler: async (args) => {
      const { name = 'default' } = args;
      const queue = queues.get(name);
      
      if (!queue) {
        console.error(`❌ Queue "${name}" not found`);
        return;
      }
      
      const stats = queue.getStats();
      
      console.log(`📊 Queue "${name}" Statistics:`);
      console.log(`   Status: ${stats.isRunning ? '🟢 Running' : '🔴 Stopped'}`);
      console.log(`   Workers: ${stats.workers}`);
      console.log(`   Total Jobs: ${stats.totalJobs}`);
      console.log(`   Active: ${stats.activeJobs}`);
      console.log(`   Waiting: ${stats.waitingJobs}`);
      console.log(`   Delayed: ${stats.delayedJobs}`);
      console.log(`   Completed: ${stats.completedJobs}`);
      console.log(`   Failed: ${stats.failedJobs}`);
      console.log(`   Avg Processing Time: ${stats.avgProcessingTime}ms`);
      console.log(`   Processors: ${stats.processors.join(', ')}`);
      
      return stats;
    }
  },
  
  'queue:jobs': {
    description: 'List jobs in queue',
    handler: async (args) => {
      const { name = 'default', status, limit = 10 } = args;
      const queue = queues.get(name);
      
      if (!queue) {
        console.error(`❌ Queue "${name}" not found`);
        return;
      }
      
      const jobs = queue.getJobs(status, limit);
      
      if (jobs.length === 0) {
        console.log('📋 No jobs found');
        return;
      }
      
      console.log(`📋 Jobs in queue "${name}"${status ? ` (${status})` : ''}:`);
      
      jobs.forEach(job => {
        const duration = job.completedAt 
          ? `${job.processingTime}ms`
          : job.startedAt 
            ? `${Date.now() - job.startedAt}ms`
            : 'N/A';
            
        console.log(`   ${job.id} - ${job.type} - ${job.status} - ${duration} - Priority: ${job.priority}`);
        
        if (job.progress > 0 && job.progress < 100) {
          console.log(`     Progress: ${job.progress}%`);
        }
        
        if (job.error) {
          console.log(`     Error: ${job.error}`);
        }
      });
      
      return jobs;
    }
  },
  
  'queue:add': {
    description: 'Add job to queue',
    handler: async (args) => {
      const { name = 'default', type, data, priority = 0, delay = 0 } = args;
      
      if (!type) {
        console.error('❌ Job type required');
        return;
      }
      
      const queue = getQueue(name);
      
      let jobData;
      try {
        jobData = typeof data === 'string' ? JSON.parse(data) : data;
      } catch {
        jobData = { input: data };
      }
      
      const job = await queue.add(type, jobData, { priority, delay });
      
      console.log(`✅ Job added: ${job.id}`);
      console.log(`   Type: ${job.type}`);
      console.log(`   Priority: ${job.priority}`);
      if (job.delay > 0) {
        console.log(`   Delayed: ${job.delay}ms`);
      }
      
      return job;
    }
  },
  
  'queue:remove': {
    description: 'Remove job from queue',
    handler: async (args) => {
      const { name = 'default', jobId } = args;
      
      if (!jobId) {
        console.error('❌ Job ID required');
        return;
      }
      
      const queue = queues.get(name);
      if (!queue) {
        console.error(`❌ Queue "${name}" not found`);
        return;
      }
      
      const removed = await queue.remove(jobId);
      
      if (removed) {
        console.log(`✅ Job removed: ${jobId}`);
      } else {
        console.log(`❌ Job not found or cannot be removed: ${jobId}`);
      }
      
      return removed;
    }
  },
  
  'queue:clean': {
    description: 'Clean old completed/failed jobs',
    handler: async (args) => {
      const { name = 'default', hours = 24 } = args;
      const queue = queues.get(name);
      
      if (!queue) {
        console.error(`❌ Queue "${name}" not found`);
        return;
      }
      
      const cleaned = await queue.clean(hours * 60 * 60 * 1000);
      console.log(`🧹 Cleaned ${cleaned} old jobs from queue "${name}"`);
      
      return cleaned;
    }
  }
};

// Criar e exportar o módulo
const queueModule = createModule('queue')
  .version('1.0.0')
  .description('Asynchronous job processing with priority, retries, and scalable workers')
  
  // Hooks
  .hook('before:process', processViaQueue)
  
  // Comandos CLI
  .command('queue:start', queueCommands['queue:start'])
  .command('queue:stats', queueCommands['queue:stats'])
  .command('queue:jobs', queueCommands['queue:jobs'])
  .command('queue:add', queueCommands['queue:add'])
  .command('queue:remove', queueCommands['queue:remove'])
  .command('queue:clean', queueCommands['queue:clean'])
  
  .build();

// Adicionar classes e utilitários ao módulo
queueModule.JobQueue = JobQueue;
queueModule.getQueue = getQueue;
queueModule.getAllQueues = () => queues;

module.exports = queueModule;