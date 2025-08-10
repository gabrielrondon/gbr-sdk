# Arquitetura de Banco de Dados - gbr-csv SDK

## Estratégia de Banco Isolado (Recomendado)

### Por que usar um banco separado?

1. **Isolamento Total**: Zero risco de afetar o banco principal
2. **Performance**: Queries otimizadas sem impactar produção
3. **Auditoria**: Log completo de todas operações
4. **Rollback Fácil**: Pode limpar/resetar sem riscos
5. **Compliance**: Separação clara para LGPD/GDPR

## 1. Arquitetura Proposta

```
┌─────────────────┐         ┌─────────────────┐
│   Banco Main    │         │  Banco gbr-csv  │
│   (Produção)    │ ──ETL──>│   (Processamento)│
└─────────────────┘         └─────────────────┘
        ↑                            ↓
        │                            │
        └──── Sync Results ─────────┘
```

### Fluxo de Dados
1. **Extração**: Dados do banco principal via ETL/Views
2. **Processamento**: gbr-csv processa no banco isolado
3. **Validação**: Resultados verificados antes do sync
4. **Sincronização**: Apenas dados validados voltam ao principal

## 2. Schema do Banco gbr-csv

### PostgreSQL (Recomendado)
```sql
-- Database creation
CREATE DATABASE gbr_csv_processor;

-- Schema principal
CREATE SCHEMA IF NOT EXISTS processing;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS audit;

-- Tabela de arquivos para processar
CREATE TABLE processing.csv_queue (
    id SERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    status VARCHAR(50) DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    scheduled_for TIMESTAMP,
    CONSTRAINT status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'))
);

-- Tabela de dados processados
CREATE TABLE processing.processed_data (
    id SERIAL PRIMARY KEY,
    queue_id INTEGER REFERENCES processing.csv_queue(id),
    line_number INTEGER NOT NULL,
    raw_data JSONB NOT NULL,
    hash VARCHAR(64) NOT NULL,
    validation_status VARCHAR(20) NOT NULL,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hash (hash),
    INDEX idx_queue_id (queue_id)
);

-- Tabela de erros de validação
CREATE TABLE processing.validation_errors (
    id SERIAL PRIMARY KEY,
    queue_id INTEGER REFERENCES processing.csv_queue(id),
    line_number INTEGER NOT NULL,
    error_type VARCHAR(100) NOT NULL,
    error_message TEXT NOT NULL,
    raw_data TEXT,
    occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_queue_errors (queue_id)
);

-- Tabela de auditoria
CREATE TABLE audit.processing_log (
    id SERIAL PRIMARY KEY,
    queue_id INTEGER,
    action VARCHAR(50) NOT NULL,
    user_id VARCHAR(100),
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_queue (queue_id),
    INDEX idx_audit_date (created_at)
);

-- Tabela de configurações
CREATE TABLE processing.config (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100)
);

-- Views para análise
CREATE VIEW processing.daily_stats AS
SELECT 
    DATE(processed_at) as date,
    COUNT(*) as total_processed,
    SUM(CASE WHEN validation_status = 'valid' THEN 1 ELSE 0 END) as valid_rows,
    SUM(CASE WHEN validation_status = 'invalid' THEN 1 ELSE 0 END) as invalid_rows,
    AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) as avg_processing_time
FROM processing.processed_data pd
JOIN processing.csv_queue cq ON pd.queue_id = cq.id
GROUP BY DATE(processed_at);
```

### MySQL/MariaDB
```sql
CREATE DATABASE gbr_csv_processor;
USE gbr_csv_processor;

-- Estrutura similar adaptada para MySQL
CREATE TABLE csv_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    status ENUM('pending', 'processing', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
    priority INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    scheduled_for TIMESTAMP NULL,
    INDEX idx_status (status),
    INDEX idx_priority (priority)
);

CREATE TABLE processed_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    queue_id INT,
    line_number INT NOT NULL,
    raw_data JSON NOT NULL,
    hash VARCHAR(64) NOT NULL,
    validation_status VARCHAR(20) NOT NULL,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (queue_id) REFERENCES csv_queue(id),
    INDEX idx_hash (hash),
    INDEX idx_queue_id (queue_id)
);
```

## 3. Integração com o SDK

### Configuração via Environment
```javascript
// .env
DB_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gbr_csv_processor
DB_USER=gbr_processor
DB_PASSWORD=secure_password
DB_POOL_SIZE=10
```

### Wrapper para Banco de Dados
```javascript
// db-processor.js
const { processCsv } = require('gbr-csv');
const { Pool } = require('pg');

class GbrCsvDatabaseProcessor {
  constructor(config) {
    this.pool = new Pool(config);
    this.batchSize = config.batchSize || 1000;
  }

  async processFromQueue() {
    const client = await this.pool.connect();
    
    try {
      // Pega próximo arquivo da fila
      const { rows } = await client.query(`
        UPDATE csv_queue 
        SET status = 'processing' 
        WHERE id = (
          SELECT id FROM csv_queue 
          WHERE status = 'pending' 
          ORDER BY priority DESC, created_at ASC 
          LIMIT 1
        )
        RETURNING *
      `);
      
      if (rows.length === 0) return null;
      
      const queueItem = rows[0];
      
      // Processa com o SDK
      const result = await processCsv(queueItem.file_path);
      
      // Salva resultados em batch
      await this.saveResults(client, queueItem.id, result);
      
      // Atualiza status
      await client.query(
        'UPDATE csv_queue SET status = $1 WHERE id = $2',
        ['completed', queueItem.id]
      );
      
      return result;
      
    } catch (error) {
      await client.query(
        'UPDATE csv_queue SET status = $1 WHERE id = $2',
        ['failed', queueItem.id]
      );
      throw error;
    } finally {
      client.release();
    }
  }

  async saveResults(client, queueId, result) {
    // Insere dados válidos em batch
    if (result.processed_rows.length > 0) {
      const values = result.processed_rows.map(row => 
        `(${queueId}, ${row.line}, '${JSON.stringify(row.data)}'::jsonb, '${row.hash}', 'valid')`
      );
      
      for (let i = 0; i < values.length; i += this.batchSize) {
        const batch = values.slice(i, i + this.batchSize);
        await client.query(`
          INSERT INTO processed_data (queue_id, line_number, raw_data, hash, validation_status)
          VALUES ${batch.join(',')}
        `);
      }
    }
    
    // Insere erros
    if (result.errors.length > 0) {
      const errorValues = result.errors.map(err =>
        `(${queueId}, ${err.line}, 'validation_error', '${err.error}', '${err.raw_data}')`
      );
      
      await client.query(`
        INSERT INTO validation_errors (queue_id, line_number, error_type, error_message, raw_data)
        VALUES ${errorValues.join(',')}
      `);
    }
  }
}
```

## 4. Sincronização com Banco Principal

### Estratégia 1: Views Materialized
```sql
-- No banco principal, cria view para dados validados
CREATE MATERIALIZED VIEW main_db.validated_csv_data AS
SELECT 
    pd.hash,
    pd.raw_data,
    pd.processed_at
FROM gbr_csv_processor.processing.processed_data pd
WHERE pd.validation_status = 'valid'
WITH DATA;

-- Refresh periódico
REFRESH MATERIALIZED VIEW main_db.validated_csv_data;
```

### Estratégia 2: ETL com Triggers
```sql
-- Trigger no banco gbr-csv para sync automático
CREATE OR REPLACE FUNCTION sync_to_main()
RETURNS TRIGGER AS $$
BEGIN
    -- Insere no banco principal via dblink
    PERFORM dblink_exec('main_db', 
        format('INSERT INTO validated_data VALUES (%L, %L)', 
               NEW.hash, NEW.raw_data)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_validation
AFTER INSERT ON processing.processed_data
FOR EACH ROW
WHEN (NEW.validation_status = 'valid')
EXECUTE FUNCTION sync_to_main();
```

### Estratégia 3: Message Queue
```javascript
// Usa RabbitMQ/Kafka para sync assíncrono
const amqp = require('amqplib');

async function publishToMainDB(data) {
  const connection = await amqp.connect('amqp://localhost');
  const channel = await connection.createChannel();
  
  await channel.assertQueue('csv_validated_data');
  
  channel.sendToQueue('csv_validated_data', 
    Buffer.from(JSON.stringify(data))
  );
}

// No processador
processor.on('row_validated', async (row) => {
  await publishToMainDB(row);
});
```

## 5. Docker Compose para Desenvolvimento

```yaml
version: '3.8'

services:
  gbr-postgres:
    image: postgres:14
    container_name: gbr_csv_db
    environment:
      POSTGRES_DB: gbr_csv_processor
      POSTGRES_USER: gbr_processor
      POSTGRES_PASSWORD: secure_password
    volumes:
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
      - gbr_data:/var/lib/postgresql/data
    ports:
      - "5433:5432"
    networks:
      - gbr_network

  gbr-redis:
    image: redis:alpine
    container_name: gbr_cache
    ports:
      - "6380:6379"
    networks:
      - gbr_network

  gbr-processor:
    build: .
    container_name: gbr_processor
    depends_on:
      - gbr-postgres
      - gbr-redis
    environment:
      DB_HOST: gbr-postgres
      REDIS_HOST: gbr-redis
    volumes:
      - ./data:/app/data
    networks:
      - gbr_network

volumes:
  gbr_data:

networks:
  gbr_network:
    driver: bridge
```

## 6. Monitoramento e Métricas

### Queries de Monitoramento
```sql
-- Performance por hora
SELECT 
    DATE_TRUNC('hour', processed_at) as hour,
    COUNT(*) as rows_processed,
    AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) as avg_time,
    MIN(EXTRACT(EPOCH FROM (processed_at - created_at))) as min_time,
    MAX(EXTRACT(EPOCH FROM (processed_at - created_at))) as max_time
FROM processing.processed_data pd
JOIN processing.csv_queue cq ON pd.queue_id = cq.id
WHERE processed_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', processed_at)
ORDER BY hour DESC;

-- Taxa de erro
SELECT 
    COUNT(CASE WHEN status = 'completed' THEN 1 END)::float / 
    COUNT(*)::float * 100 as success_rate
FROM processing.csv_queue
WHERE created_at > NOW() - INTERVAL '7 days';

-- Arquivos pendentes
SELECT 
    status,
    COUNT(*) as count,
    AVG(EXTRACT(EPOCH FROM (NOW() - created_at))) as avg_wait_time
FROM processing.csv_queue
GROUP BY status;
```

### Dashboard Grafana
```json
{
  "dashboard": {
    "title": "GBR CSV Processor",
    "panels": [
      {
        "title": "Processing Rate",
        "query": "SELECT date_trunc('minute', processed_at) as time, count(*) FROM processed_data GROUP BY 1"
      },
      {
        "title": "Error Rate",
        "query": "SELECT count(*) FROM validation_errors WHERE occurred_at > NOW() - INTERVAL '1 hour'"
      },
      {
        "title": "Queue Status",
        "query": "SELECT status, count(*) FROM csv_queue GROUP BY status"
      }
    ]
  }
}
```

## 7. Backup e Recovery

### Estratégia de Backup
```bash
#!/bin/bash
# backup.sh

# Backup apenas dados processados (não arquivos temporários)
pg_dump -h localhost -U gbr_processor \
  -t processing.processed_data \
  -t processing.validation_errors \
  -t audit.processing_log \
  gbr_csv_processor > backup_$(date +%Y%m%d).sql

# Compacta e move para storage
gzip backup_$(date +%Y%m%d).sql
aws s3 cp backup_$(date +%Y%m%d).sql.gz s3://backups/gbr-csv/
```

### Recovery
```bash
# Restore específico
psql -h localhost -U gbr_processor gbr_csv_processor < backup_20240101.sql

# Ou restore seletivo
pg_restore -h localhost -U gbr_processor \
  -d gbr_csv_processor \
  -t processed_data \
  backup_20240101.dump
```

## 8. Segurança

### Usuário com Permissões Mínimas
```sql
-- Cria usuário específico para o SDK
CREATE USER gbr_sdk_user WITH PASSWORD 'strong_password';

-- Permissões mínimas necessárias
GRANT CONNECT ON DATABASE gbr_csv_processor TO gbr_sdk_user;
GRANT USAGE ON SCHEMA processing TO gbr_sdk_user;
GRANT SELECT, INSERT, UPDATE ON processing.csv_queue TO gbr_sdk_user;
GRANT SELECT, INSERT ON processing.processed_data TO gbr_sdk_user;
GRANT SELECT, INSERT ON processing.validation_errors TO gbr_sdk_user;
GRANT INSERT ON audit.processing_log TO gbr_sdk_user;

-- Revoga permissões desnecessárias
REVOKE CREATE ON SCHEMA processing FROM gbr_sdk_user;
REVOKE ALL ON SCHEMA public FROM gbr_sdk_user;
```

### Criptografia de Dados Sensíveis
```javascript
const crypto = require('crypto');

class EncryptedProcessor {
  constructor(encryptionKey) {
    this.algorithm = 'aes-256-gcm';
    this.key = Buffer.from(encryptionKey, 'hex');
  }

  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  async processAndEncrypt(filePath) {
    const result = await processCsv(filePath);
    
    // Criptografa dados sensíveis antes de salvar
    result.processed_rows = result.processed_rows.map(row => ({
      ...row,
      data: this.encrypt(JSON.stringify(row.data))
    }));
    
    return result;
  }
}
```

## 9. Exemplo Completo de Implementação

```javascript
// complete-setup.js
const { processCsv } = require('gbr-csv');
const { Pool } = require('pg');
const Redis = require('redis');

class GbrCsvCompleteSetup {
  constructor(config) {
    // Banco isolado para processamento
    this.processingDB = new Pool({
      host: config.processing_db_host,
      database: 'gbr_csv_processor',
      ...config.processing_db
    });
    
    // Conexão com banco principal (read-only)
    this.mainDB = new Pool({
      host: config.main_db_host,
      database: config.main_db_name,
      ...config.main_db
    });
    
    // Cache Redis
    this.redis = Redis.createClient({
      host: config.redis_host
    });
  }

  async setupDatabase() {
    // Cria schema se não existir
    await this.processingDB.query(`
      CREATE SCHEMA IF NOT EXISTS processing;
      CREATE SCHEMA IF NOT EXISTS audit;
    `);
    
    // Cria tabelas
    // ... (queries SQL acima)
    
    console.log('Database setup completed');
  }

  async importFromMainDB() {
    // Importa dados do banco principal
    const mainData = await this.mainDB.query(`
      SELECT * FROM csv_files_to_process 
      WHERE status = 'pending'
      LIMIT 100
    `);
    
    // Insere na fila de processamento
    for (const row of mainData.rows) {
      await this.processingDB.query(`
        INSERT INTO processing.csv_queue (file_name, file_path)
        VALUES ($1, $2)
      `, [row.file_name, row.file_path]);
    }
  }

  async processQueue() {
    while (true) {
      const file = await this.getNextFile();
      if (!file) {
        await this.sleep(5000); // Aguarda 5 segundos
        continue;
      }
      
      try {
        const result = await processCsv(file.file_path);
        await this.saveResults(file.id, result);
        await this.syncToMainDB(file.id);
      } catch (error) {
        await this.handleError(file.id, error);
      }
    }
  }

  async syncToMainDB(queueId) {
    // Pega dados validados
    const validated = await this.processingDB.query(`
      SELECT * FROM processing.processed_data
      WHERE queue_id = $1 AND validation_status = 'valid'
    `, [queueId]);
    
    // Sync com banco principal
    const client = await this.mainDB.connect();
    try {
      await client.query('BEGIN');
      
      for (const row of validated.rows) {
        await client.query(`
          INSERT INTO validated_csv_data (hash, data, source)
          VALUES ($1, $2, 'gbr-csv')
        `, [row.hash, row.raw_data]);
      }
      
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

// Inicialização
const processor = new GbrCsvCompleteSetup({
  processing_db: {
    host: 'localhost',
    port: 5433,
    user: 'gbr_processor',
    password: process.env.DB_PASSWORD
  },
  main_db: {
    host: 'localhost',
    port: 5432,
    user: 'readonly_user',
    password: process.env.MAIN_DB_PASSWORD
  },
  redis_host: 'localhost'
});

processor.setupDatabase()
  .then(() => processor.processQueue())
  .catch(console.error);
```

## 10. Documentação para Cliente

### Quick Start
```bash
# 1. Clone o repositório de setup
git clone https://github.com/seu-repo/gbr-csv-setup

# 2. Configure as variáveis de ambiente
cp .env.example .env
# Edite .env com suas configurações

# 3. Inicie os containers
docker-compose up -d

# 4. Execute o setup inicial
npm run setup:database

# 5. Inicie o processador
npm run start:processor
```

### Requisitos Mínimos
- PostgreSQL 12+ ou MySQL 8+
- Node.js 14+
- Redis (opcional, para cache)
- 2GB RAM mínimo
- 10GB espaço em disco para banco

### FAQ

**P: Posso usar meu banco existente?**
R: Sim, mas recomendamos fortemente um banco separado para isolamento e performance.

**P: Como faço backup?**
R: Use os scripts fornecidos ou configure backup automático do PostgreSQL/MySQL.

**P: Posso processar em múltiplas threads?**
R: Sim, o sistema suporta múltiplos workers. Configure `WORKER_COUNT` no .env.

**P: Como monitoro o processamento?**
R: Use as queries de monitoramento fornecidas ou configure Grafana com nosso dashboard.