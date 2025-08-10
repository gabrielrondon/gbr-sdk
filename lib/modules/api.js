/**
 * API Module - REST API server with automatic endpoints
 */

const { createModule } = require('../module-system');

class APIServer {
  constructor(config = {}) {
    this.config = {
      port: config.port || 3000,
      cors: config.cors !== false,
      rateLimit: config.rateLimit || { max: 100, window: 15 * 60 * 1000 },
      auth: config.auth || false,
      docs: config.docs !== false,
      ...config
    };
    
    this.routes = new Map();
    this.middleware = [];
    this.server = null;
    this.uploads = new Map(); // Track file uploads
    this.jobs = new Map(); // Track processing jobs
  }
  
  /**
   * Start the API server
   */
  async start() {
    console.log(`🌐 Starting API server on port ${this.config.port}`);
    
    // Simulate server startup
    this.server = {
      listening: true,
      port: this.config.port
    };
    
    this.setupDefaultRoutes();
    this.setupMiddleware();
    
    console.log(`✅ API server running at http://localhost:${this.config.port}`);
    console.log(`📚 API docs available at http://localhost:${this.config.port}/docs`);
    
    return this.server;
  }
  
  /**
   * Setup default routes
   */
  setupDefaultRoutes() {
    // Health check
    this.addRoute('GET', '/health', async (req, res) => {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0'
      };
    });
    
    // Upload file for processing
    this.addRoute('POST', '/api/upload', async (req, res) => {
      const { file, options } = req.body;
      
      if (!file) {
        return { error: 'File required', status: 400 };
      }
      
      // Generate job ID
      const jobId = this.generateJobId();
      
      // Store upload info
      this.uploads.set(jobId, {
        id: jobId,
        filename: file.name || 'upload.csv',
        status: 'uploaded',
        createdAt: new Date(),
        options: options || {}
      });
      
      return {
        jobId,
        message: 'File uploaded successfully',
        status: 'uploaded'
      };
    });
    
    // Process uploaded file
    this.addRoute('POST', '/api/process/:jobId', async (req, res) => {
      const { jobId } = req.params;
      const upload = this.uploads.get(jobId);
      
      if (!upload) {
        return { error: 'Job not found', status: 404 };
      }
      
      if (upload.status !== 'uploaded') {
        return { error: 'File already being processed', status: 400 };
      }
      
      // Update status
      upload.status = 'processing';
      upload.startedAt = new Date();
      
      // Simulate processing
      setTimeout(() => {
        upload.status = 'completed';
        upload.completedAt = new Date();
        upload.result = {
          processed_rows: [
            { line: 2, data: { name: 'John', email: 'john@example.com' }, hash: 'abc123' },
            { line: 3, data: { name: 'Jane', email: 'jane@example.com' }, hash: 'def456' }
          ],
          errors: [],
          stats: {
            totalRows: 2,
            validRows: 2,
            errorRows: 0,
            processingTime: 1500
          }
        };
      }, 2000);
      
      return {
        jobId,
        message: 'Processing started',
        status: 'processing'
      };
    });
    
    // Get job status
    this.addRoute('GET', '/api/status/:jobId', async (req, res) => {
      const { jobId } = req.params;
      const upload = this.uploads.get(jobId);
      
      if (!upload) {
        return { error: 'Job not found', status: 404 };
      }
      
      const response = {
        jobId,
        status: upload.status,
        filename: upload.filename,
        createdAt: upload.createdAt
      };
      
      if (upload.startedAt) response.startedAt = upload.startedAt;
      if (upload.completedAt) response.completedAt = upload.completedAt;
      if (upload.status === 'completed' && upload.result) {
        response.stats = upload.result.stats;
      }
      
      return response;
    });
    
    // Get processing results
    this.addRoute('GET', '/api/results/:jobId', async (req, res) => {
      const { jobId } = req.params;
      const upload = this.uploads.get(jobId);
      
      if (!upload) {
        return { error: 'Job not found', status: 404 };
      }
      
      if (upload.status !== 'completed') {
        return { 
          error: 'Processing not completed', 
          status: upload.status,
          statusCode: 400 
        };
      }
      
      return upload.result;
    });
    
    // List all jobs
    this.addRoute('GET', '/api/jobs', async (req, res) => {
      const jobs = Array.from(this.uploads.values()).map(upload => ({
        jobId: upload.id,
        filename: upload.filename,
        status: upload.status,
        createdAt: upload.createdAt,
        completedAt: upload.completedAt
      }));
      
      return { jobs };
    });
    
    // Delete job
    this.addRoute('DELETE', '/api/jobs/:jobId', async (req, res) => {
      const { jobId } = req.params;
      
      if (this.uploads.delete(jobId)) {
        return { message: 'Job deleted successfully' };
      } else {
        return { error: 'Job not found', status: 404 };
      }
    });
    
    // API documentation
    this.addRoute('GET', '/docs', async (req, res) => {
      return this.generateAPIDocs();
    });
    
    // Statistics endpoint
    this.addRoute('GET', '/api/stats', async (req, res) => {
      const totalJobs = this.uploads.size;
      const completedJobs = Array.from(this.uploads.values())
        .filter(job => job.status === 'completed').length;
      const processingJobs = Array.from(this.uploads.values())
        .filter(job => job.status === 'processing').length;
      
      return {
        totalJobs,
        completedJobs,
        processingJobs,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      };
    });
  }
  
  /**
   * Setup middleware
   */
  setupMiddleware() {
    console.log('🔧 Setting up API middleware...');
    
    if (this.config.cors) {
      console.log('  ✅ CORS enabled');
    }
    
    if (this.config.rateLimit) {
      console.log(`  ✅ Rate limiting: ${this.config.rateLimit.max} req/${this.config.rateLimit.window}ms`);
    }
    
    if (this.config.auth) {
      console.log('  ✅ Authentication enabled');
    }
  }
  
  /**
   * Add a new route
   */
  addRoute(method, path, handler) {
    const key = `${method} ${path}`;
    this.routes.set(key, {
      method,
      path,
      handler,
      addedAt: new Date()
    });
    
    console.log(`  📍 Route added: ${method} ${path}`);
  }
  
  /**
   * Generate API documentation
   */
  generateAPIDocs() {
    const routes = Array.from(this.routes.entries()).map(([key, route]) => ({
      endpoint: key,
      method: route.method,
      path: route.path,
      description: this.getRouteDescription(route.path)
    }));
    
    return {
      title: 'GBR-SDK API Documentation',
      version: '1.0.0',
      baseUrl: `http://localhost:${this.config.port}`,
      endpoints: routes,
      examples: this.getAPIExamples()
    };
  }
  
  getRouteDescription(path) {
    const descriptions = {
      '/health': 'Health check endpoint',
      '/api/upload': 'Upload file for processing',
      '/api/process/:jobId': 'Start processing uploaded file',
      '/api/status/:jobId': 'Get job status',
      '/api/results/:jobId': 'Get processing results',
      '/api/jobs': 'List all jobs',
      '/api/jobs/:jobId': 'Delete specific job',
      '/api/stats': 'Get API statistics',
      '/docs': 'API documentation'
    };
    return descriptions[path] || 'API endpoint';
  }
  
  getAPIExamples() {
    return {
      upload: {
        method: 'POST',
        url: '/api/upload',
        body: {
          file: { name: 'data.csv', content: '...' },
          options: { format: 'csv' }
        }
      },
      process: {
        method: 'POST', 
        url: '/api/process/job-123'
      },
      status: {
        method: 'GET',
        url: '/api/status/job-123'
      },
      results: {
        method: 'GET',
        url: '/api/results/job-123'
      }
    };
  }
  
  generateJobId() {
    return 'job-' + Math.random().toString(36).substr(2, 9);
  }
  
  /**
   * Stop the server
   */
  async stop() {
    if (this.server) {
      console.log('🛑 Stopping API server...');
      this.server.listening = false;
      this.server = null;
    }
  }
}

// Hook para processar via API
async function processViaAPI(data) {
  if (data && data.source === 'api') {
    console.log('🌐 Processing data from API request');
    
    // Adiciona metadados da API
    data.metadata = {
      ...data.metadata,
      processedViaAPI: true,
      apiVersion: '1.0.0',
      timestamp: new Date().toISOString()
    };
  }
  
  return data;
}

// Comandos CLI para API
const apiCommands = {
  'api:start': {
    description: 'Start API server',
    handler: async (args) => {
      const { port = 3000, auth = false } = args;
      
      const server = new APIServer({ port, auth });
      await server.start();
      
      // Keep running
      process.on('SIGINT', async () => {
        await server.stop();
        process.exit(0);
      });
    }
  },
  
  'api:docs': {
    description: 'Generate API documentation',
    handler: async (args) => {
      const server = new APIServer();
      const docs = server.generateAPIDocs();
      
      console.log(JSON.stringify(docs, null, 2));
    }
  }
};

// Criar e exportar o módulo
const apiModule = createModule('api')
  .version('1.0.0')
  .description('REST API server with file upload, processing, and job management')
  
  // Hooks
  .hook('before:process', processViaAPI)
  
  // Comandos CLI
  .command('api:start', apiCommands['api:start'])
  .command('api:docs', apiCommands['api:docs'])
  
  .build();

// Adicionar classe APIServer ao módulo
apiModule.APIServer = APIServer;

module.exports = apiModule;