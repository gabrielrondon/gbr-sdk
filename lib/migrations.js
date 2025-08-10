/**
 * Database Migration System for gbr-csv
 * Manages schema versioning and updates
 */

class MigrationManager {
  constructor(connection, dbType) {
    this.connection = connection;
    this.dbType = dbType;
    this.migrations = this.loadMigrations();
  }

  /**
   * Load all migrations in order
   */
  loadMigrations() {
    return [
      {
        version: 1,
        name: 'initial_setup',
        up: this.migration001_initialSetup.bind(this),
        down: this.migration001_initialSetup_down.bind(this)
      },
      {
        version: 2,
        name: 'add_batch_processing',
        up: this.migration002_addBatchProcessing.bind(this),
        down: this.migration002_addBatchProcessing_down.bind(this)
      },
      {
        version: 3,
        name: 'add_performance_indexes',
        up: this.migration003_addPerformanceIndexes.bind(this),
        down: this.migration003_addPerformanceIndexes_down.bind(this)
      },
      {
        version: 4,
        name: 'add_data_partitioning',
        up: this.migration004_addDataPartitioning.bind(this),
        down: this.migration004_addDataPartitioning_down.bind(this)
      }
    ];
  }

  /**
   * Create migrations table if not exists
   */
  async ensureMigrationsTable() {
    if (this.dbType === 'postgresql') {
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS processing.migrations (
          version INTEGER PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else if (this.dbType === 'mysql') {
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          version INT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
  }

  /**
   * Get current database version
   */
  async getCurrentVersion() {
    try {
      let result;
      if (this.dbType === 'postgresql') {
        result = await this.connection.query(
          'SELECT MAX(version) as version FROM processing.migrations'
        );
        return result.rows[0].version || 0;
      } else if (this.dbType === 'mysql') {
        const [rows] = await this.connection.query(
          'SELECT MAX(version) as version FROM migrations'
        );
        return rows[0].version || 0;
      }
    } catch (e) {
      return 0; // No migrations table yet
    }
  }

  /**
   * Run all pending migrations
   */
  async migrate() {
    await this.ensureMigrationsTable();
    const currentVersion = await this.getCurrentVersion();
    
    console.log(`📦 Current database version: ${currentVersion}`);
    
    const pendingMigrations = this.migrations.filter(m => m.version > currentVersion);
    
    if (pendingMigrations.length === 0) {
      console.log('✅ Database is up to date');
      return;
    }
    
    console.log(`🔄 Running ${pendingMigrations.length} migrations...`);
    
    for (const migration of pendingMigrations) {
      console.log(`  ▶ Migration ${migration.version}: ${migration.name}`);
      
      try {
        await this.connection.query('BEGIN');
        
        // Run migration
        await migration.up();
        
        // Record migration
        if (this.dbType === 'postgresql') {
          await this.connection.query(
            'INSERT INTO processing.migrations (version, name) VALUES ($1, $2)',
            [migration.version, migration.name]
          );
        } else if (this.dbType === 'mysql') {
          await this.connection.query(
            'INSERT INTO migrations (version, name) VALUES (?, ?)',
            [migration.version, migration.name]
          );
        }
        
        await this.connection.query('COMMIT');
        console.log(`    ✓ Completed`);
        
      } catch (error) {
        await this.connection.query('ROLLBACK');
        console.error(`    ✗ Failed: ${error.message}`);
        throw error;
      }
    }
    
    console.log('✅ All migrations completed successfully');
  }

  /**
   * Rollback to specific version
   */
  async rollback(targetVersion = null) {
    const currentVersion = await this.getCurrentVersion();
    
    if (targetVersion === null) {
      targetVersion = currentVersion - 1;
    }
    
    if (targetVersion >= currentVersion) {
      console.log('❌ Target version must be lower than current version');
      return;
    }
    
    const migrationsToRollback = this.migrations
      .filter(m => m.version > targetVersion && m.version <= currentVersion)
      .reverse();
    
    console.log(`🔄 Rolling back ${migrationsToRollback.length} migrations...`);
    
    for (const migration of migrationsToRollback) {
      console.log(`  ▶ Rollback ${migration.version}: ${migration.name}`);
      
      try {
        await this.connection.query('BEGIN');
        
        // Run rollback
        await migration.down();
        
        // Remove migration record
        if (this.dbType === 'postgresql') {
          await this.connection.query(
            'DELETE FROM processing.migrations WHERE version = $1',
            [migration.version]
          );
        } else if (this.dbType === 'mysql') {
          await this.connection.query(
            'DELETE FROM migrations WHERE version = ?',
            [migration.version]
          );
        }
        
        await this.connection.query('COMMIT');
        console.log(`    ✓ Rolled back`);
        
      } catch (error) {
        await this.connection.query('ROLLBACK');
        console.error(`    ✗ Failed: ${error.message}`);
        throw error;
      }
    }
    
    console.log('✅ Rollback completed');
  }

  // ============= MIGRATIONS =============

  /**
   * Migration 001: Initial setup
   */
  async migration001_initialSetup() {
    // This is handled by the main setup
    // Just a placeholder for version tracking
  }

  async migration001_initialSetup_down() {
    // Drop all initial tables
    if (this.dbType === 'postgresql') {
      await this.connection.query('DROP SCHEMA IF EXISTS processing CASCADE');
      await this.connection.query('DROP SCHEMA IF EXISTS staging CASCADE');
      await this.connection.query('DROP SCHEMA IF EXISTS audit CASCADE');
    }
  }

  /**
   * Migration 002: Add batch processing support
   */
  async migration002_addBatchProcessing() {
    if (this.dbType === 'postgresql') {
      // Add batch_id to processed_data
      await this.connection.query(`
        ALTER TABLE processing.processed_data 
        ADD COLUMN IF NOT EXISTS batch_id UUID,
        ADD COLUMN IF NOT EXISTS batch_sequence INTEGER
      `);
      
      // Create batch processing table
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS processing.batch_jobs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          queue_id INTEGER REFERENCES processing.csv_queue(id),
          status VARCHAR(50) DEFAULT 'pending',
          total_rows INTEGER,
          processed_rows INTEGER DEFAULT 0,
          error_rows INTEGER DEFAULT 0,
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          worker_id VARCHAR(100),
          metadata JSONB
        )
      `);
      
      // Add index
      await this.connection.query(`
        CREATE INDEX IF NOT EXISTS idx_batch_jobs_status 
        ON processing.batch_jobs(status, started_at)
      `);
    } else if (this.dbType === 'mysql') {
      // MySQL implementation
      await this.connection.query(`
        ALTER TABLE processed_data 
        ADD COLUMN batch_id VARCHAR(36),
        ADD COLUMN batch_sequence INT
      `);
      
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS batch_jobs (
          id VARCHAR(36) PRIMARY KEY,
          queue_id INT,
          status VARCHAR(50) DEFAULT 'pending',
          total_rows INT,
          processed_rows INT DEFAULT 0,
          error_rows INT DEFAULT 0,
          started_at TIMESTAMP NULL,
          completed_at TIMESTAMP NULL,
          worker_id VARCHAR(100),
          metadata JSON,
          FOREIGN KEY (queue_id) REFERENCES csv_queue(id)
        )
      `);
    }
  }

  async migration002_addBatchProcessing_down() {
    if (this.dbType === 'postgresql') {
      await this.connection.query('DROP TABLE IF EXISTS processing.batch_jobs');
      await this.connection.query(`
        ALTER TABLE processing.processed_data 
        DROP COLUMN IF EXISTS batch_id,
        DROP COLUMN IF EXISTS batch_sequence
      `);
    } else if (this.dbType === 'mysql') {
      await this.connection.query('DROP TABLE IF EXISTS batch_jobs');
      await this.connection.query(`
        ALTER TABLE processed_data 
        DROP COLUMN batch_id,
        DROP COLUMN batch_sequence
      `);
    }
  }

  /**
   * Migration 003: Add performance indexes
   */
  async migration003_addPerformanceIndexes() {
    const indexes = [];
    
    if (this.dbType === 'postgresql') {
      indexes.push(
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_processed_date ON processing.processed_data(processed_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_queue_composite ON processing.csv_queue(status, priority DESC, created_at ASC)',
        'CREATE INDEX IF NOT EXISTS idx_errors_composite ON processing.validation_errors(queue_id, error_type)',
        'CREATE INDEX IF NOT EXISTS idx_audit_user ON audit.processing_log(user_id, created_at DESC)'
      );
    } else if (this.dbType === 'mysql') {
      indexes.push(
        'CREATE INDEX idx_processed_date ON processed_data(processed_at DESC)',
        'CREATE INDEX idx_queue_composite ON csv_queue(status, priority DESC, created_at ASC)',
        'CREATE INDEX idx_errors_composite ON validation_errors(queue_id, error_type)'
      );
    }
    
    for (const index of indexes) {
      try {
        await this.connection.query(index);
      } catch (e) {
        // Index might already exist
      }
    }
  }

  async migration003_addPerformanceIndexes_down() {
    const dropIndexes = [];
    
    if (this.dbType === 'postgresql') {
      dropIndexes.push(
        'DROP INDEX IF EXISTS processing.idx_processed_date',
        'DROP INDEX IF EXISTS processing.idx_queue_composite',
        'DROP INDEX IF EXISTS processing.idx_errors_composite',
        'DROP INDEX IF EXISTS audit.idx_audit_user'
      );
    } else if (this.dbType === 'mysql') {
      dropIndexes.push(
        'DROP INDEX idx_processed_date ON processed_data',
        'DROP INDEX idx_queue_composite ON csv_queue',
        'DROP INDEX idx_errors_composite ON validation_errors'
      );
    }
    
    for (const dropIndex of dropIndexes) {
      try {
        await this.connection.query(dropIndex);
      } catch (e) {
        // Index might not exist
      }
    }
  }

  /**
   * Migration 004: Add data partitioning for large datasets
   */
  async migration004_addDataPartitioning() {
    if (this.dbType === 'postgresql') {
      // Convert processed_data to partitioned table
      await this.connection.query(`
        -- Create partitioned table
        CREATE TABLE IF NOT EXISTS processing.processed_data_partitioned (
          LIKE processing.processed_data INCLUDING ALL
        ) PARTITION BY RANGE (processed_at);
        
        -- Create monthly partitions for the next 12 months
        DO $$
        DECLARE
          start_date date := date_trunc('month', CURRENT_DATE);
          end_date date;
          partition_name text;
        BEGIN
          FOR i IN 0..11 LOOP
            end_date := start_date + interval '1 month';
            partition_name := 'processed_data_' || to_char(start_date, 'YYYY_MM');
            
            EXECUTE format('
              CREATE TABLE IF NOT EXISTS processing.%I 
              PARTITION OF processing.processed_data_partitioned
              FOR VALUES FROM (%L) TO (%L)',
              partition_name, start_date, end_date
            );
            
            start_date := end_date;
          END LOOP;
        END $$;
      `);
      
      // Add automatic partition creation function
      await this.connection.query(`
        CREATE OR REPLACE FUNCTION processing.create_monthly_partition()
        RETURNS void AS $$
        DECLARE
          partition_date date;
          partition_name text;
          start_date date;
          end_date date;
        BEGIN
          partition_date := date_trunc('month', CURRENT_DATE + interval '1 month');
          partition_name := 'processed_data_' || to_char(partition_date, 'YYYY_MM');
          start_date := partition_date;
          end_date := partition_date + interval '1 month';
          
          IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'processing'
            AND c.relname = partition_name
          ) THEN
            EXECUTE format('
              CREATE TABLE processing.%I 
              PARTITION OF processing.processed_data_partitioned
              FOR VALUES FROM (%L) TO (%L)',
              partition_name, start_date, end_date
            );
          END IF;
        END;
        $$ LANGUAGE plpgsql;
      `);
      
      // Schedule monthly partition creation
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS processing.partition_maintenance (
          last_run TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        INSERT INTO processing.partition_maintenance DEFAULT VALUES
        ON CONFLICT DO NOTHING;
      `);
    }
    // MySQL doesn't support declarative partitioning in the same way
    // Would need to implement differently or skip for MySQL
  }

  async migration004_addDataPartitioning_down() {
    if (this.dbType === 'postgresql') {
      await this.connection.query('DROP TABLE IF EXISTS processing.processed_data_partitioned CASCADE');
      await this.connection.query('DROP FUNCTION IF EXISTS processing.create_monthly_partition()');
      await this.connection.query('DROP TABLE IF EXISTS processing.partition_maintenance');
    }
  }
}

module.exports = MigrationManager;