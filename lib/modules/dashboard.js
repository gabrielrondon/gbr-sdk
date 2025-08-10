/**
 * Dashboard Module - Web dashboard for monitoring and management
 */

const { createModule } = require('../module-system');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

class WebDashboard {
  constructor(config = {}) {
    this.config = {
      port: config.port || 3000,
      host: config.host || 'localhost',
      auth: config.auth || false,
      authToken: config.authToken || this.generateToken(),
      staticPath: config.staticPath || path.join(__dirname, '../dashboard'),
      autoRefresh: config.autoRefresh !== false,
      refreshInterval: config.refreshInterval || 5000,
      ...config
    };
    
    this.server = null;
    this.isRunning = false;
    this.connections = new Set();
    this.metrics = new Map();
    
    this.init();
  }
  
  async init() {
    console.log('🌐 Initializing web dashboard...');
    
    // Create static files directory
    this.createStaticFiles();
    
    // Create HTTP server
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
    
    // Handle server errors
    this.server.on('error', (error) => {
      console.error('Dashboard server error:', error.message);
    });
    
    console.log('✅ Web dashboard initialized');
  }
  
  /**
   * Start the web dashboard
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️ Dashboard already running');
      return;
    }
    
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, (error) => {
        if (error) {
          reject(error);
          return;
        }
        
        this.isRunning = true;
        const url = `http://${this.config.host}:${this.config.port}`;
        
        console.log(`🌐 Dashboard started at ${url}`);
        if (this.config.auth) {
          console.log(`🔐 Authentication required. Token: ${this.config.authToken}`);
        }
        
        resolve(url);
      });
    });
  }
  
  /**
   * Stop the web dashboard
   */
  async stop() {
    if (!this.isRunning) return;
    
    return new Promise((resolve) => {
      // Close all connections
      for (const connection of this.connections) {
        connection.destroy();
      }
      
      this.server.close(() => {
        this.isRunning = false;
        console.log('🛑 Dashboard stopped');
        resolve();
      });
    });
  }
  
  /**
   * Update metrics data
   */
  updateMetrics(source, data) {
    this.metrics.set(source, {
      data,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get dashboard status
   */
  getStatus() {
    return {
      running: this.isRunning,
      url: this.isRunning ? `http://${this.config.host}:${this.config.port}` : null,
      connections: this.connections.size,
      uptime: this.isRunning ? process.uptime() * 1000 : 0,
      metrics: this.metrics.size
    };
  }
  
  // Private methods
  handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;
    
    // Track connection
    this.connections.add(req.socket);
    req.socket.on('close', () => {
      this.connections.delete(req.socket);
    });
    
    // Handle authentication
    if (this.config.auth && !this.isAuthenticated(req)) {
      this.sendUnauthorized(res);
      return;
    }
    
    // Route handling
    if (pathname === '/') {
      this.serveDashboard(res);
    } else if (pathname === '/api/status') {
      this.serveStatus(res);
    } else if (pathname === '/api/metrics') {
      this.serveMetrics(res, query);
    } else if (pathname === '/api/logs') {
      this.serveLogs(res, query);
    } else if (pathname === '/api/plugins') {
      this.servePlugins(res);
    } else if (pathname === '/api/system') {
      this.serveSystem(res);
    } else if (pathname.startsWith('/static/')) {
      this.serveStatic(res, pathname);
    } else {
      this.send404(res);
    }
  }
  
  isAuthenticated(req) {
    const authHeader = req.headers.authorization;
    const token = url.parse(req.url, true).query.token;
    
    if (authHeader) {
      const [type, credentials] = authHeader.split(' ');
      return type === 'Bearer' && credentials === this.config.authToken;
    }
    
    return token === this.config.authToken;
  }
  
  serveDashboard(res) {
    const html = this.generateDashboardHTML();
    
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache'
    });
    res.end(html);
  }
  
  serveStatus(res) {
    const status = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      version: require('../../package.json').version,
      environment: process.env.NODE_ENV || 'development'
    };
    
    this.sendJSON(res, status);
  }
  
  serveMetrics(res, query) {
    const { source, limit = 100 } = query;
    let metrics = Array.from(this.metrics.entries()).map(([key, value]) => ({
      source: key,
      data: value.data,
      timestamp: value.timestamp
    }));
    
    if (source) {
      metrics = metrics.filter(m => m.source === source);
    }
    
    metrics = metrics.slice(0, parseInt(limit));
    
    this.sendJSON(res, { metrics });
  }
  
  serveLogs(res, query) {
    // Try to get logs from monitoring module
    try {
      const monitoringModule = require('./monitoring');
      const logger = monitoringModule.getGlobalLogger();
      
      if (logger) {
        const { level, limit = 50 } = query;
        const logs = logger.getLogs(level, parseInt(limit));
        this.sendJSON(res, { logs });
      } else {
        this.sendJSON(res, { logs: [] });
      }
    } catch (error) {
      this.sendJSON(res, { logs: [], error: 'Monitoring module not available' });
    }
  }
  
  servePlugins(res) {
    // Try to get plugin info from marketplace module
    try {
      const marketplaceModule = require('./marketplace');
      const marketplace = marketplaceModule.getGlobalMarketplace();
      
      if (marketplace) {
        const installed = marketplace.listInstalled();
        this.sendJSON(res, { plugins: installed });
      } else {
        this.sendJSON(res, { plugins: [] });
      }
    } catch (error) {
      this.sendJSON(res, { plugins: [], error: 'Marketplace module not available' });
    }
  }
  
  serveSystem(res) {
    const system = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
      uptime: process.uptime(),
      memory: {
        rss: process.memoryUsage().rss,
        heapUsed: process.memoryUsage().heapUsed,
        heapTotal: process.memoryUsage().heapTotal,
        external: process.memoryUsage().external
      },
      cpu: process.cpuUsage(),
      loadAverage: require('os').loadavg(),
      freeMemory: require('os').freemem(),
      totalMemory: require('os').totalmem()
    };
    
    this.sendJSON(res, system);
  }
  
  serveStatic(res, pathname) {
    const filePath = path.join(this.config.staticPath, pathname.replace('/static/', ''));
    
    if (!fs.existsSync(filePath)) {
      this.send404(res);
      return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml'
    };
    
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    try {
      const content = fs.readFileSync(filePath);
      
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(content);
    } catch (error) {
      this.send500(res, error.message);
    }
  }
  
  sendJSON(res, data) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify(data, null, 2));
  }
  
  sendUnauthorized(res) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized');
  }
  
  send404(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
  
  send500(res, message) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Internal Server Error: ${message}`);
  }
  
  generateDashboardHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GBR SDK Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 30px;
            text-align: center;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
        }
        
        .header h1 {
            color: #667eea;
            font-size: 2.5em;
            margin-bottom: 10px;
            font-weight: 700;
        }
        
        .header p {
            color: #666;
            font-size: 1.1em;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 25px;
            text-align: center;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
            transition: transform 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
        }
        
        .stat-card h3 {
            color: #667eea;
            font-size: 1.3em;
            margin-bottom: 10px;
        }
        
        .stat-card .value {
            font-size: 2.5em;
            font-weight: 700;
            color: #333;
            margin-bottom: 5px;
        }
        
        .stat-card .label {
            color: #666;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .main-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
        }
        
        .panel {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
        }
        
        .panel h2 {
            color: #667eea;
            margin-bottom: 20px;
            font-size: 1.5em;
        }
        
        .log-entry {
            padding: 8px;
            margin-bottom: 5px;
            border-radius: 5px;
            font-family: 'Courier New', monospace;
            font-size: 0.85em;
        }
        
        .log-error { background: #fee; color: #c33; }
        .log-warn { background: #ffc; color: #963; }
        .log-info { background: #eef; color: #369; }
        .log-debug { background: #efe; color: #396; }
        
        .plugin-item {
            padding: 10px;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .plugin-item:last-child {
            border-bottom: none;
        }
        
        .plugin-name {
            font-weight: 600;
            color: #333;
        }
        
        .plugin-version {
            color: #666;
            font-size: 0.9em;
        }
        
        .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 8px;
        }
        
        .status-running { background: #4CAF50; }
        .status-stopped { background: #f44336; }
        .status-warning { background: #ff9800; }
        
        .footer {
            text-align: center;
            padding: 30px;
            color: rgba(255, 255, 255, 0.8);
            font-size: 0.9em;
        }
        
        @media (max-width: 768px) {
            .main-grid {
                grid-template-columns: 1fr;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
        }
        
        .loading {
            text-align: center;
            color: #666;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 GBR SDK Dashboard</h1>
            <p>On-premise data processing platform monitoring</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <h3>System Status</h3>
                <div class="value" id="system-status">
                    <span class="status-indicator status-running"></span>Online
                </div>
                <div class="label">Current Status</div>
            </div>
            <div class="stat-card">
                <h3>Uptime</h3>
                <div class="value" id="uptime">0s</div>
                <div class="label">System Uptime</div>
            </div>
            <div class="stat-card">
                <h3>Memory Usage</h3>
                <div class="value" id="memory">0 MB</div>
                <div class="label">Heap Used</div>
            </div>
            <div class="stat-card">
                <h3>Active Plugins</h3>
                <div class="value" id="plugins-count">0</div>
                <div class="label">Installed</div>
            </div>
        </div>
        
        <div class="main-grid">
            <div class="panel">
                <h2>📊 System Metrics</h2>
                <div id="metrics-content" class="loading">Loading metrics...</div>
            </div>
            
            <div class="panel">
                <h2>📋 Recent Logs</h2>
                <div id="logs-content" class="loading">Loading logs...</div>
            </div>
            
            <div class="panel">
                <h2>🔌 Installed Plugins</h2>
                <div id="plugins-content" class="loading">Loading plugins...</div>
            </div>
            
            <div class="panel">
                <h2>⚙️ System Information</h2>
                <div id="system-content" class="loading">Loading system info...</div>
            </div>
        </div>
        
        <div class="footer">
            <p>🤖 Generated with GBR SDK v${require('../../package.json').version || '1.0.0'}</p>
            <p>Last updated: <span id="last-updated">Never</span></p>
        </div>
    </div>
    
    <script>
        const API_BASE = '';
        
        // Format bytes to human readable
        function formatBytes(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        }
        
        // Format uptime
        function formatUptime(seconds) {
            const days = Math.floor(seconds / (24 * 60 * 60));
            const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
            const minutes = Math.floor((seconds % (60 * 60)) / 60);
            
            if (days > 0) return \`\${days}d \${hours}h \${minutes}m\`;
            if (hours > 0) return \`\${hours}h \${minutes}m\`;
            return \`\${minutes}m \${Math.floor(seconds % 60)}s\`;
        }
        
        // Update status
        async function updateStatus() {
            try {
                const response = await fetch(API_BASE + '/api/status');
                const data = await response.json();
                
                document.getElementById('uptime').textContent = formatUptime(data.uptime);
                document.getElementById('memory').textContent = formatBytes(data.memory.heapUsed);
                
            } catch (error) {
                console.error('Failed to fetch status:', error);
            }
        }
        
        // Update metrics
        async function updateMetrics() {
            try {
                const response = await fetch(API_BASE + '/api/metrics');
                const data = await response.json();
                
                const content = document.getElementById('metrics-content');
                
                if (data.metrics.length === 0) {
                    content.innerHTML = '<p>No metrics available</p>';
                    return;
                }
                
                let html = '';
                data.metrics.forEach(metric => {
                    html += \`<div style="margin-bottom: 10px;">
                        <strong>\${metric.source}</strong><br>
                        <small>\${new Date(metric.timestamp).toLocaleString()}</small>
                    </div>\`;
                });
                
                content.innerHTML = html;
                
            } catch (error) {
                document.getElementById('metrics-content').innerHTML = '<p>Error loading metrics</p>';
            }
        }
        
        // Update logs
        async function updateLogs() {
            try {
                const response = await fetch(API_BASE + '/api/logs?limit=10');
                const data = await response.json();
                
                const content = document.getElementById('logs-content');
                
                if (data.logs.length === 0) {
                    content.innerHTML = '<p>No logs available</p>';
                    return;
                }
                
                let html = '';
                data.logs.forEach(log => {
                    html += \`<div class="log-entry log-\${log.level}">
                        [\${new Date(log.timestamp).toLocaleTimeString()}] \${log.level.toUpperCase()}: \${log.message}
                    </div>\`;
                });
                
                content.innerHTML = html;
                
            } catch (error) {
                document.getElementById('logs-content').innerHTML = '<p>Error loading logs</p>';
            }
        }
        
        // Update plugins
        async function updatePlugins() {
            try {
                const response = await fetch(API_BASE + '/api/plugins');
                const data = await response.json();
                
                const content = document.getElementById('plugins-content');
                const countEl = document.getElementById('plugins-count');
                
                if (data.plugins.length === 0) {
                    content.innerHTML = '<p>No plugins installed</p>';
                    countEl.textContent = '0';
                    return;
                }
                
                countEl.textContent = data.plugins.length;
                
                let html = '';
                data.plugins.forEach(plugin => {
                    html += \`<div class="plugin-item">
                        <div>
                            <div class="plugin-name">\${plugin.name}</div>
                            <div class="plugin-version">v\${plugin.version}</div>
                        </div>
                        <span class="status-indicator status-running"></span>
                    </div>\`;
                });
                
                content.innerHTML = html;
                
            } catch (error) {
                document.getElementById('plugins-content').innerHTML = '<p>Error loading plugins</p>';
                document.getElementById('plugins-count').textContent = '0';
            }
        }
        
        // Update system info
        async function updateSystemInfo() {
            try {
                const response = await fetch(API_BASE + '/api/system');
                const data = await response.json();
                
                const content = document.getElementById('system-content');
                
                const html = \`
                    <div style="font-family: monospace; font-size: 0.85em;">
                        <div><strong>Platform:</strong> \${data.platform} (\${data.arch})</div>
                        <div><strong>Node.js:</strong> \${data.nodeVersion}</div>
                        <div><strong>PID:</strong> \${data.pid}</div>
                        <div><strong>Memory:</strong> \${formatBytes(data.memory.rss)} RSS</div>
                        <div><strong>Free Memory:</strong> \${formatBytes(data.freeMemory)}</div>
                        <div><strong>Total Memory:</strong> \${formatBytes(data.totalMemory)}</div>
                    </div>
                \`;
                
                content.innerHTML = html;
                
            } catch (error) {
                document.getElementById('system-content').innerHTML = '<p>Error loading system info</p>';
            }
        }
        
        // Update all data
        function updateAll() {
            updateStatus();
            updateMetrics();
            updateLogs();
            updatePlugins();
            updateSystemInfo();
            
            document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
        }
        
        // Initialize dashboard
        updateAll();
        
        // Auto refresh every 5 seconds
        ${this.config.autoRefresh ? `setInterval(updateAll, ${this.config.refreshInterval});` : ''}
    </script>
</body>
</html>`;
  }
  
  createStaticFiles() {
    const staticDir = this.config.staticPath;
    
    if (!fs.existsSync(staticDir)) {
      fs.mkdirSync(staticDir, { recursive: true });
    }
    
    // Create a simple favicon
    const faviconPath = path.join(staticDir, 'favicon.ico');
    if (!fs.existsSync(faviconPath)) {
      // Create a minimal ICO file (16x16 transparent)
      const iconData = Buffer.from([
        0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10,
        0x00, 0x00, 0x01, 0x00, 0x20, 0x00, 0x68, 0x04,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
      ]);
      fs.writeFileSync(faviconPath, iconData);
    }
  }
  
  generateToken() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }
}

// Global dashboard instance
let globalDashboard = null;

// Hook para atualização de métricas do dashboard
async function updateDashboardMetrics(data) {
  if (!globalDashboard || !data) return data;
  
  // Update dashboard with processing metrics
  globalDashboard.updateMetrics('processing', {
    timestamp: new Date().toISOString(),
    filePath: data.filePath,
    processedRows: data.processed_rows?.length || 0,
    errors: data.errors?.length || 0,
    duration: data.processingTime
  });
  
  return data;
}

// Comandos CLI para dashboard
const dashboardCommands = {
  'dashboard:start': {
    description: 'Start web dashboard',
    handler: async (args) => {
      const { port = 3000, host = 'localhost', auth = false } = args;
      
      if (!globalDashboard) {
        globalDashboard = new WebDashboard({ port, host, auth });
      }
      
      const url = await globalDashboard.start();
      
      console.log(`🎯 Dashboard is now available at: ${url}`);
      if (auth) {
        console.log(`🔐 Authentication required. Use token: ${globalDashboard.config.authToken}`);
      }
      
      return { url, running: true };
    }
  },
  
  'dashboard:stop': {
    description: 'Stop web dashboard',
    handler: async () => {
      if (!globalDashboard) {
        console.error('❌ Dashboard not running');
        return;
      }
      
      await globalDashboard.stop();
      return { running: false };
    }
  },
  
  'dashboard:status': {
    description: 'Show dashboard status',
    handler: async () => {
      if (!globalDashboard) {
        console.log('📊 Dashboard Status: Stopped');
        return { running: false };
      }
      
      const status = globalDashboard.getStatus();
      
      console.log('📊 Dashboard Status:');
      console.log(`   Running: ${status.running ? '✅' : '❌'}`);
      if (status.url) {
        console.log(`   URL: ${status.url}`);
      }
      console.log(`   Connections: ${status.connections}`);
      console.log(`   Uptime: ${Math.round(status.uptime / 1000)}s`);
      console.log(`   Metrics: ${status.metrics} sources`);
      
      return status;
    }
  },
  
  'dashboard:open': {
    description: 'Open dashboard in browser',
    handler: async () => {
      if (!globalDashboard || !globalDashboard.isRunning) {
        console.error('❌ Dashboard not running. Start it first with "dashboard:start"');
        return;
      }
      
      const url = `http://${globalDashboard.config.host}:${globalDashboard.config.port}`;
      console.log(`🌐 Opening dashboard: ${url}`);
      
      // Try to open in browser (cross-platform)
      const { exec } = require('child_process');
      const command = process.platform === 'darwin' ? 'open' :
                     process.platform === 'win32' ? 'start' : 'xdg-open';
      
      exec(`${command} "${url}"`, (error) => {
        if (error) {
          console.warn('Could not open browser automatically. Please navigate to:', url);
        } else {
          console.log('✅ Dashboard opened in browser');
        }
      });
      
      return { url };
    }
  }
};

// Criar e exportar o módulo
const dashboardModule = createModule('dashboard')
  .version('1.0.0')
  .description('Web dashboard for real-time monitoring, management, and system visualization')
  
  // Hooks
  .hook('after:process', updateDashboardMetrics)
  
  // Comandos CLI
  .command('dashboard:start', dashboardCommands['dashboard:start'])
  .command('dashboard:stop', dashboardCommands['dashboard:stop'])
  .command('dashboard:status', dashboardCommands['dashboard:status'])
  .command('dashboard:open', dashboardCommands['dashboard:open'])
  
  .build();

// Adicionar classes e utilitários ao módulo
dashboardModule.WebDashboard = WebDashboard;
dashboardModule.getGlobalDashboard = () => globalDashboard;
dashboardModule.setGlobalDashboard = (dashboard) => { globalDashboard = dashboard; };

module.exports = dashboardModule;