<?php
declare(strict_types=1);

function st_table_exists(PDO $db,string $table): bool {
    $q=$db->prepare('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?');
    $q->execute([$table]);return (int)$q->fetchColumn()>0;
}
function st_column_exists(PDO $db,string $table,string $column): bool {
    $q=$db->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?');
    $q->execute([$table,$column]);return (int)$q->fetchColumn()>0;
}
function st_index_exists(PDO $db,string $table,string $index): bool {
    $q=$db->prepare('SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?');
    $q->execute([$table,$index]);return (int)$q->fetchColumn()>0;
}
function st_add_column(PDO $db,string $table,string $column,string $definition): void {
    if(!st_column_exists($db,$table,$column))$db->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
}

function st_run_migrations(PDO $db): void {
    if(!st_table_exists($db,'users'))return;
    $db->exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INT NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $done=array_map('intval',$db->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN));

    if(!in_array(1,$done,true)){
        // Role expansion + per-user language.
        $db->exec("ALTER TABLE users MODIFY role ENUM('ADMIN','CLEANER','OWNER','MANAGER') NOT NULL");
        st_add_column($db,'users','language',"VARCHAR(5) NOT NULL DEFAULT 'ru' AFTER phone");
        $db->prepare('UPDATE users SET language=? WHERE language IS NULL OR language=?')->execute(['ru','']);
        $db->exec('INSERT INTO schema_migrations(version) VALUES(1)');
    }

    if(!in_array(2,$done,true)){
        $db->exec("CREATE TABLE IF NOT EXISTS client_accounts (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL UNIQUE,
          account_type ENUM('OWNER','MANAGER') NOT NULL DEFAULT 'OWNER',
          company_name VARCHAR(190) NULL,
          billing_name VARCHAR(190) NULL,
          ico VARCHAR(40) NULL,
          dic VARCHAR(40) NULL,
          ic_dph VARCHAR(40) NULL,
          billing_address VARCHAR(255) NULL,
          notes TEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_client_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        st_add_column($db,'objects','client_id','BIGINT UNSIGNED NULL AFTER id');
        st_add_column($db,'objects','client_price','DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER payout');
        st_add_column($db,'objects','approval_status',"VARCHAR(20) NOT NULL DEFAULT 'APPROVED' AFTER active");
        if(!st_index_exists($db,'objects','idx_objects_client'))$db->exec('ALTER TABLE objects ADD INDEX idx_objects_client (client_id)');
        $db->exec('INSERT INTO schema_migrations(version) VALUES(2)');
    }

    if(!in_array(3,$done,true)){
        st_add_column($db,'cleaning_jobs','client_id','BIGINT UNSIGNED NULL AFTER object_id');
        st_add_column($db,'cleaning_jobs','client_price','DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER payout');
        st_add_column($db,'cleaning_jobs','extra_revenue','DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER bonus');
        st_add_column($db,'cleaning_jobs','extra_cost','DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER extra_revenue');
        st_add_column($db,'cleaning_jobs','financial_status',"VARCHAR(20) NOT NULL DEFAULT 'PENDING' AFTER extra_cost");
        st_add_column($db,'cleaning_jobs','booking_source',"VARCHAR(30) NOT NULL DEFAULT 'ADMIN' AFTER financial_status");
        st_add_column($db,'cleaning_jobs','created_by_user_id','BIGINT UNSIGNED NULL AFTER booking_source');
        if(!st_index_exists($db,'cleaning_jobs','idx_jobs_client_date'))$db->exec('ALTER TABLE cleaning_jobs ADD INDEX idx_jobs_client_date (client_id,service_date)');
        // Backfill snapshots from existing object records.
        $db->exec('UPDATE cleaning_jobs j JOIN objects o ON o.id=j.object_id SET j.client_id=o.client_id,j.client_price=o.client_price WHERE j.client_id IS NULL OR j.client_price=0');
        $db->exec('INSERT INTO schema_migrations(version) VALUES(3)');
    }

    if(!in_array(4,$done,true)){
        $db->exec("CREATE TABLE IF NOT EXISTS financial_entries (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          entry_date DATE NOT NULL,
          entry_type ENUM('INCOME','EXPENSE') NOT NULL,
          category VARCHAR(100) NOT NULL DEFAULT 'OTHER',
          amount DECIMAL(12,2) NOT NULL,
          description VARCHAR(255) NULL,
          client_id BIGINT UNSIGNED NULL,
          object_id BIGINT UNSIGNED NULL,
          job_id BIGINT UNSIGNED NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_finance_date (entry_date),
          INDEX idx_finance_client (client_id,entry_date),
          CONSTRAINT fk_fin_client FOREIGN KEY (client_id) REFERENCES client_accounts(id) ON DELETE SET NULL,
          CONSTRAINT fk_fin_object FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE SET NULL,
          CONSTRAINT fk_fin_job FOREIGN KEY (job_id) REFERENCES cleaning_jobs(id) ON DELETE SET NULL,
          CONSTRAINT fk_fin_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $db->exec('INSERT INTO schema_migrations(version) VALUES(4)');
    }

    if(!in_array(5,$done,true)){
        st_set_setting($db,'clientBookingStepMinutes',30);
        st_set_setting($db,'clientCancellationCutoffHours',12);
        st_set_setting($db,'defaultLanguage','ru');
        $db->exec('INSERT INTO schema_migrations(version) VALUES(5)');
    }
}
