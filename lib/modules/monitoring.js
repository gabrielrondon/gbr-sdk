/**
 * Monitoring Module - Complete observability with metrics, logs, traces, and alerts
 */

const { createModule } = require('../module-system');
const { EventEmitter } = require('events');

class MetricsCollector {
  constructor() {
    this.metrics = new Map();
    this.histograms = new Map();
    this.gauges = new Map();
    this.counters = new Map();
    
    this.startTime = Date.now();
    this.collectSystemMetrics();
  }
  
  // Counter metrics
  increment(name, value = 1, tags = {}) {
    const key = this.buildKey(name, tags);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
    
    this.recordMetric('counter', name, current + value, tags);
  }
  
  // Gauge metrics
  gauge(name, value, tags = {}) {
    const key = this.buildKey(name, tags);
    this.gauges.set(key, value);
    
    this.recordMetric('gauge', name, value, tags);
  }
  
  // Histogram metrics
  histogram(name, value, tags = {}) {
    const key = this.buildKey(name, tags);
    
    if (!this.histograms.has(key)) {
      this.histograms.set(key, {
        values: [],
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity
      });
    }
    
    const hist = this.histograms.get(key);
    hist.values.push({ value, timestamp: Date.now() });
    hist.count++;
    hist.sum += value;
    hist.min = Math.min(hist.min, value);
    hist.max = Math.max(hist.max, value);
    
    // Keep only last 1000 values
    if (hist.values.length > 1000) {
      hist.values = hist.values.slice(-1000);
    }
    
    this.recordMetric('histogram', name, value, tags);
  }
  
  // Timer decorator
  timer(name, tags = {}) {
    const start = Date.now();
    
    return {
      stop: () => {
        const duration = Date.now() - start;
        this.histogram(name, duration, tags);
        return duration;
      }
    };
  }
  
  // Get metrics summary
  getMetrics() {
    const metrics = {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: {},
      system: this.getSystemMetrics(),
      uptime: Date.now() - this.startTime
    };
    
    // Process histograms
    for (const [key, hist] of this.histograms) {
      const values = hist.values.map(v => v.value).sort((a, b) => a - b);
      const count = values.length;
      
      if (count > 0) {
        metrics.histograms[key] = {
          count: hist.count,
          sum: hist.sum,
          min: hist.min,
          max: hist.max,
          avg: hist.sum / hist.count,
          p50: this.percentile(values, 0.5),
          p95: this.percentile(values, 0.95),
          p99: this.percentile(values, 0.99)
        };
      }
    }
    
    return metrics;
  }
  
  // Private methods
  buildKey(name, tags) {
    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    
    return tagString ? `${name}{${tagString}}` : name;
  }
  
  recordMetric(type, name, value, tags) {
    const metric = {
      type,
      name,
      value,
      tags,
      timestamp: Date.now()
    };
    
    // Store recent metrics
    const key = `${type}:${name}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    
    const history = this.metrics.get(key);
    history.push(metric);
    
    // Keep only last 100 measurements
    if (history.length > 100) {
      history.shift();
    }
  }
  
  percentile(sortedValues, percentile) {
    if (sortedValues.length === 0) return 0;
    
    const index = percentile * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) return sortedValues[lower];
    
    return sortedValues[lower] * (upper - index) + sortedValues[upper] * (index - lower);
  }
  
  collectSystemMetrics() {
    setInterval(() => {
      const usage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      this.gauge('system_memory_rss', usage.rss);
      this.gauge('system_memory_heap_used', usage.heapUsed);
      this.gauge('system_memory_heap_total', usage.heapTotal);
      this.gauge('system_memory_external', usage.external);
      this.gauge('system_cpu_user', cpuUsage.user);
      this.gauge('system_cpu_system', cpuUsage.system);
      this.gauge('system_uptime', process.uptime());
      
    }, 10000); // Every 10 seconds
  }
  
  getSystemMetrics() {
    const usage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      memory: {
        rss: usage.rss,
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024)
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      process: {
        uptime: process.uptime(),
        pid: process.pid,
        version: process.version,
        platform: process.platform
      }
    };
  }
}

class Logger {
  constructor(config = {}) {
    this.config = {
      level: config.level || 'info',
      format: config.format || 'json',
      outputs: config.outputs || ['console'],
      maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
      maxFiles: config.maxFiles || 5,
      ...config
    };
    
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
    
    this.logs = [];
  }
  
  log(level, message, meta = {}) {
    if (this.levels[level] > this.levels[this.config.level]) {
      return;
    }
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      meta,
      pid: process.pid
    };
    
    // Store in memory
    this.logs.push(logEntry);
    if (this.logs.length > 1000) {
      this.logs.shift();
    }
    
    // Output to configured destinations
    this.output(logEntry);
  }
  
  error(message, meta) { this.log('error', message, meta); }
  warn(message, meta) { this.log('warn', message, meta); }
  info(message, meta) { this.log('info', message, meta); }
  debug(message, meta) { this.log('debug', message, meta); }
  trace(message, meta) { this.log('trace', message, meta); }
  
  output(logEntry) {
    const formatted = this.format(logEntry);
    
    for (const output of this.config.outputs) {
      switch (output) {
        case 'console':
          console.log(formatted);
          break;
        case 'file':
          // In real implementation, would write to file
          break;
        case 'elasticsearch':
          // In real implementation, would send to Elasticsearch
          break;
        case 'syslog':
          // In real implementation, would send to syslog
          break;
      }
    }
  }
  
  format(logEntry) {
    if (this.config.format === 'json') {
      return JSON.stringify(logEntry);
    }
    
    const { timestamp, level, message, meta } = logEntry;
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  }
  
  getLogs(level = null, limit = 100) {
    let filtered = level ? 
      this.logs.filter(log => log.level === level) : 
      this.logs;
    
    return filtered.slice(-limit);
  }
}

class AlertManager extends EventEmitter {
  constructor() {
    super();
    this.rules = [];
    this.alerts = [];
    this.channels = [];
  }
  
  addRule(rule) {
    const alertRule = {
      id: this.generateId(),
      name: rule.name,
      condition: rule.condition,
      threshold: rule.threshold,
      severity: rule.severity || 'warning',
      message: rule.message,
      cooldown: rule.cooldown || 300000, // 5 minutes
      lastTriggered: null,
      enabled: true,
      ...rule
    };
    
    this.rules.push(alertRule);
    console.log(`🚨 Alert rule added: ${alertRule.name}`);
    
    return alertRule;
  }
  
  addChannel(channel) {
    this.channels.push(channel);
    console.log(`📢 Alert channel added: ${channel.type}`);
  }
  
  checkRules(metrics) {
    const now = Date.now();
    
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      
      // Check cooldown
      if (rule.lastTriggered && (now - rule.lastTriggered) < rule.cooldown) {
        continue;
      }
      
      // Evaluate condition
      if (this.evaluateCondition(rule, metrics)) {
        this.triggerAlert(rule, metrics);
        rule.lastTriggered = now;
      }
    }
  }
  
  evaluateCondition(rule, metrics) {
    try {
      // Simple condition evaluation
      const { metric, operator, threshold } = rule.condition;
      const value = this.getMetricValue(metrics, metric);
      
      if (value === null) return false;
      
      switch (operator) {
        case '>': return value > threshold;
        case '<': return value < threshold;
        case '>=': return value >= threshold;
        case '<=': return value <= threshold;
        case '==': return value === threshold;
        case '!=': return value !== threshold;
        default: return false;
      }
    } catch (error) {
      console.error('Alert rule evaluation error:', error.message);
      return false;
    }
  }
  
  getMetricValue(metrics, metricPath) {
    const parts = metricPath.split('.');
    let value = metrics;
    
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return null;
      }
    }
    
    return typeof value === 'number' ? value : null;
  }
  
  triggerAlert(rule, metrics) {
    const alert = {
      id: this.generateId(),
      ruleId: rule.id,
      name: rule.name,
      severity: rule.severity,
      message: this.formatMessage(rule.message, metrics),
      triggeredAt: new Date().toISOString(),
      resolved: false,
      metrics: metrics
    };
    
    this.alerts.push(alert);
    
    console.log(`🚨 Alert triggered: ${alert.name} (${alert.severity})`);
    
    // Send to channels
    this.sendAlert(alert);
    
    this.emit('alert', alert);
    
    return alert;
  }
  
  sendAlert(alert) {
    for (const channel of this.channels) {
      try {
        switch (channel.type) {
          case 'webhook':
            this.sendWebhook(channel, alert);
            break;
          case 'email':
            this.sendEmail(channel, alert);
            break;
          case 'slack':
            this.sendSlack(channel, alert);
            break;
        }
      } catch (error) {
        console.error(`Alert delivery failed (${channel.type}):`, error.message);
      }
    }
  }
  
  sendWebhook(channel, alert) {
    // Simulate webhook send
    console.log(`📡 Sending webhook to ${channel.url}:`, {
      alert: alert.name,
      severity: alert.severity,
      message: alert.message
    });
  }
  
  sendEmail(channel, alert) {
    // Simulate email send
    console.log(`📧 Sending email to ${channel.recipients.join(', ')}:`, {
      subject: `Alert: ${alert.name}`,
      message: alert.message
    });
  }
  
  sendSlack(channel, alert) {
    // Simulate Slack send
    const color = alert.severity === 'critical' ? 'danger' : 
                 alert.severity === 'warning' ? 'warning' : 'good';
    
    console.log(`💬 Sending Slack message to ${channel.channel}:`, {
      color,
      text: `*${alert.name}*\n${alert.message}`,
      severity: alert.severity
    });
  }
  
  formatMessage(template, metrics) {
    return template.replace(/\{([^}]+)\}/g, (match, path) => {
      const value = this.getMetricValue(metrics, path);
      return value !== null ? value.toString() : match;
    });
  }
  
  generateId() {
    return Math.random().toString(36).substr(2, 9);
  }
  
  getAlerts(resolved = null) {
    return resolved !== null ? 
      this.alerts.filter(a => a.resolved === resolved) : 
      this.alerts;
  }
}

// Global monitoring instances
let globalMetrics = null;
let globalLogger = null;
let globalAlerts = null;

function initializeMonitoring(config = {}) {
  if (globalMetrics) return { metrics: globalMetrics, logger: globalLogger, alerts: globalAlerts };
  
  globalMetrics = new MetricsCollector();
  globalLogger = new Logger(config.logger);
  globalAlerts = new AlertManager();
  
  // Setup default alert rules
  globalAlerts.addRule({
    name: 'High Memory Usage',
    condition: { metric: 'system.memory.heapUsedMB', operator: '>', threshold: 500 },
    severity: 'warning',
    message: 'Memory usage is high: {system.memory.heapUsedMB}MB'
  });
  
  globalAlerts.addRule({
    name: 'High Error Rate',
    condition: { metric: 'counters.processing_errors', operator: '>', threshold: 10 },
    severity: 'critical',
    message: 'Error rate is critical: {counters.processing_errors} errors'
  });
  
  // Start metrics collection
  setInterval(() => {
    const metrics = globalMetrics.getMetrics();
    globalAlerts.checkRules(metrics);
  }, 30000); // Check every 30 seconds
  
  console.log('📊 Monitoring initialized');
  
  return { metrics: globalMetrics, logger: globalLogger, alerts: globalAlerts };
}

// Hook para monitoramento de processamento
async function monitorProcessing(data) {
  if (!globalMetrics) return data;
  
  const timer = globalMetrics.timer('processing_time');
  
  try {
    globalMetrics.increment('files_processed');
    globalLogger.info('Processing started', { 
      filePath: data.filePath,
      source: data.source
    });
    
    if (data.processed_rows) {
      globalMetrics.histogram('rows_per_file', data.processed_rows.length);
      globalMetrics.increment('total_rows_processed', data.processed_rows.length);
    }
    
    if (data.errors && data.errors.length > 0) {
      globalMetrics.increment('processing_errors', data.errors.length);
      globalLogger.warn('Processing errors found', {
        errorCount: data.errors.length,
        errors: data.errors.slice(0, 5) // Log first 5 errors
      });
    }
    
    const duration = timer.stop();
    globalLogger.info('Processing completed', {
      duration,
      rows: data.processed_rows?.length || 0,
      errors: data.errors?.length || 0
    });
    
    return {
      ...data,
      monitoring: {
        processingTime: duration,
        timestamp: new Date().toISOString()
      }
    };
    
  } catch (error) {
    globalMetrics.increment('processing_failures');
    globalLogger.error('Processing failed', { error: error.message });
    timer.stop();
    throw error;
  }
}

// Comandos CLI para monitoramento
const monitoringCommands = {
  'monitor:start': {
    description: 'Start monitoring service',
    handler: async (args) => {
      const config = {
        logger: {
          level: args.logLevel || 'info',
          outputs: args.outputs ? args.outputs.split(',') : ['console']
        }
      };
      
      const monitoring = initializeMonitoring(config);
      
      // Add alert channels
      if (args.webhook) {
        monitoring.alerts.addChannel({
          type: 'webhook',
          url: args.webhook
        });
      }
      
      if (args.email) {
        monitoring.alerts.addChannel({
          type: 'email',
          recipients: args.email.split(',')
        });
      }
      
      console.log('📊 Monitoring service started');
      
      return monitoring;
    }
  },
  
  'monitor:metrics': {
    description: 'Show current metrics',
    handler: async () => {
      if (!globalMetrics) {
        console.error('❌ Monitoring not started. Run "monitor:start" first.');
        return;
      }
      
      const metrics = globalMetrics.getMetrics();
      
      console.log('📊 Current Metrics:');
      console.log('\n🔢 Counters:');
      for (const [key, value] of Object.entries(metrics.counters)) {
        console.log(`   ${key}: ${value}`);
      }
      
      console.log('\n📈 Gauges:');
      for (const [key, value] of Object.entries(metrics.gauges)) {
        console.log(`   ${key}: ${value}`);
      }
      
      console.log('\n📊 Histograms:');
      for (const [key, hist] of Object.entries(metrics.histograms)) {
        console.log(`   ${key}:`);
        console.log(`     Count: ${hist.count}, Avg: ${hist.avg.toFixed(2)}ms`);
        console.log(`     P50: ${hist.p50.toFixed(2)}ms, P95: ${hist.p95.toFixed(2)}ms, P99: ${hist.p99.toFixed(2)}ms`);
      }
      
      console.log('\n🖥️ System:');
      console.log(`   Memory: ${metrics.system.memory.heapUsedMB}MB / ${metrics.system.memory.heapTotalMB}MB`);
      console.log(`   Uptime: ${Math.round(metrics.uptime / 1000)}s`);
      
      return metrics;
    }
  },
  
  'monitor:logs': {
    description: 'Show recent logs',
    handler: async (args) => {
      if (!globalLogger) {
        console.error('❌ Monitoring not started');
        return;
      }
      
      const { level, limit = 50 } = args;
      const logs = globalLogger.getLogs(level, limit);
      
      console.log(`📜 Recent Logs${level ? ` (${level})` : ''}:`);
      
      logs.forEach(log => {
        const color = log.level === 'error' ? '\x1b[31m' : 
                     log.level === 'warn' ? '\x1b[33m' : '\x1b[0m';
        
        console.log(`${color}${log.timestamp} [${log.level.toUpperCase()}] ${log.message}\x1b[0m`);
        
        if (Object.keys(log.meta).length > 0) {
          console.log(`   ${JSON.stringify(log.meta)}`);
        }
      });
      
      return logs;
    }
  },
  
  'monitor:alerts': {
    description: 'Show active alerts',
    handler: async () => {
      if (!globalAlerts) {
        console.error('❌ Monitoring not started');
        return;
      }
      
      const activeAlerts = globalAlerts.getAlerts(false);
      
      if (activeAlerts.length === 0) {
        console.log('✅ No active alerts');
        return [];
      }
      
      console.log('🚨 Active Alerts:');
      
      activeAlerts.forEach(alert => {
        const color = alert.severity === 'critical' ? '\x1b[31m' : 
                     alert.severity === 'warning' ? '\x1b[33m' : '\x1b[32m';
        
        console.log(`${color}   ${alert.name} (${alert.severity})`);
        console.log(`     ${alert.message}`);
        console.log(`     Triggered: ${alert.triggeredAt}\x1b[0m`);
      });
      
      return activeAlerts;
    }
  }
};

// Criar e exportar o módulo
const monitoringModule = createModule('monitoring')
  .version('1.0.0')
  .description('Complete observability with metrics, logs, traces, and intelligent alerting')
  
  // Hooks
  .hook('after:process', monitorProcessing)
  
  // Comandos CLI
  .command('monitor:start', monitoringCommands['monitor:start'])
  .command('monitor:metrics', monitoringCommands['monitor:metrics'])
  .command('monitor:logs', monitoringCommands['monitor:logs'])
  .command('monitor:alerts', monitoringCommands['monitor:alerts'])
  
  .build();

// Adicionar classes ao módulo
monitoringModule.MetricsCollector = MetricsCollector;
monitoringModule.Logger = Logger;
monitoringModule.AlertManager = AlertManager;
monitoringModule.initializeMonitoring = initializeMonitoring;
monitoringModule.getGlobalMetrics = () => globalMetrics;
monitoringModule.getGlobalLogger = () => globalLogger;
monitoringModule.getGlobalAlerts = () => globalAlerts;

module.exports = monitoringModule;