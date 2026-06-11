const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const database = process.env.MYSQL_DATABASE || 'quadras_pro';
const connectionConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'ifsp',
    charset: 'utf8mb4',
    dateStrings: true,
    multipleStatements: true
};

function escapeIdentifier(identifier) {
    const value = String(identifier || '');
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
        throw new Error(`Identificador MySQL invalido: ${value}`);
    }

    return `\`${value}\``;
}

const pool = mysql.createPool({
    ...connectionConfig,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const db = {
    allAsync: async (sql, params = []) => {
        const [rows] = await pool.query(sql, params);
        return rows;
    },

    getAsync: async (sql, params = []) => {
        const [rows] = await pool.query(sql, params);
        return rows[0];
    },

    runAsync: async (sql, params = []) => {
        const [result] = await pool.execute(sql, params);
        return {
            insertId: result.insertId,
            changes: result.affectedRows
        };
    },

    execAsync: async (sql) => {
        await pool.query(sql);
    }
};

async function createDatabaseIfNeeded() {
    const connection = await mysql.createConnection(connectionConfig);
    try {
        await connection.query(
            `CREATE DATABASE IF NOT EXISTS ${escapeIdentifier(database)}
             CHARACTER SET utf8mb4
             COLLATE utf8mb4_unicode_ci`
        );
    } finally {
        await connection.end();
    }
}

async function ensureColumn(table, column, definition) {
    const columns = await db.allAsync(
        `SELECT COLUMN_NAME
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND COLUMN_NAME = ?`,
        [table, column]
    );

    if (!columns.length) {
        await db.runAsync(
            `ALTER TABLE ${escapeIdentifier(table)}
             ADD COLUMN ${escapeIdentifier(column)} ${definition}`
        );
    }
}

async function createSchema() {
    await db.execAsync(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            nome VARCHAR(120) NOT NULL,
            email VARCHAR(190) NOT NULL,
            celular VARCHAR(20) NOT NULL,
            senha VARCHAR(255) NOT NULL,
            tipo VARCHAR(20) DEFAULT 'cliente',
            verificado TINYINT(1) DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_usuarios_email (email),
            UNIQUE KEY uk_usuarios_celular (celular)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

        CREATE TABLE IF NOT EXISTS quadras (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            nome VARCHAR(120) NOT NULL,
            tipo VARCHAR(80) NOT NULL,
            preco_hora DECIMAL(10,2) NOT NULL,
            descricao TEXT,
            imagem VARCHAR(255),
            status VARCHAR(20) DEFAULT 'disponivel',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

        CREATE TABLE IF NOT EXISTS agendamentos (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            quadra_id INT UNSIGNED NOT NULL,
            usuario_id INT UNSIGNED NOT NULL,
            cliente_nome VARCHAR(120),
            data VARCHAR(10) NOT NULL,
            horario VARCHAR(5) NOT NULL,
            duracao_horas INT DEFAULT 1,
            horario_fim VARCHAR(5),
            status VARCHAR(20) DEFAULT 'pendente',
            pix_key TEXT,
            pix_qr LONGTEXT,
            comprovante VARCHAR(255),
            valor DECIMAL(10,2),
            valor_total DECIMAL(10,2),
            valor_sinal DECIMAL(10,2),
            expires_at VARCHAR(40),
            pago_at DATETIME,
            confirmado_at DATETIME,
            observacao TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_agendamentos_quadra_data (quadra_id, data),
            KEY idx_agendamentos_usuario (usuario_id),
            CONSTRAINT fk_agendamentos_quadra
                FOREIGN KEY (quadra_id) REFERENCES quadras(id) ON DELETE CASCADE,
            CONSTRAINT fk_agendamentos_usuario
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

        CREATE TABLE IF NOT EXISTS avaliacoes (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            quadra_id INT UNSIGNED NOT NULL,
            usuario_id INT UNSIGNED NOT NULL,
            cliente_nome VARCHAR(120),
            nota INT NOT NULL,
            comentario TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_avaliacoes_quadra (quadra_id),
            KEY idx_avaliacoes_usuario (usuario_id),
            CONSTRAINT fk_avaliacoes_quadra
                FOREIGN KEY (quadra_id) REFERENCES quadras(id) ON DELETE CASCADE,
            CONSTRAINT fk_avaliacoes_usuario
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

        CREATE TABLE IF NOT EXISTS horarios_bloqueados (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            quadra_id INT UNSIGNED NOT NULL,
            data VARCHAR(10) NOT NULL,
            horario VARCHAR(5) NOT NULL,
            duracao_horas INT DEFAULT 1,
            horario_fim VARCHAR(5),
            motivo VARCHAR(120),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_bloqueios_quadra_data (quadra_id, data),
            CONSTRAINT fk_bloqueios_quadra
                FOREIGN KEY (quadra_id) REFERENCES quadras(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
}

async function migrateSchema() {
    await ensureColumn('quadras', 'descricao', 'TEXT');
    await ensureColumn('quadras', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

    await ensureColumn('agendamentos', 'duracao_horas', 'INT DEFAULT 1');
    await ensureColumn('agendamentos', 'horario_fim', 'VARCHAR(5)');
    await ensureColumn('agendamentos', 'valor_total', 'DECIMAL(10,2)');
    await ensureColumn('agendamentos', 'valor_sinal', 'DECIMAL(10,2)');
    await ensureColumn('agendamentos', 'expires_at', 'VARCHAR(40)');
    await ensureColumn('agendamentos', 'pago_at', 'DATETIME');
    await ensureColumn('agendamentos', 'confirmado_at', 'DATETIME');
    await ensureColumn('agendamentos', 'observacao', 'TEXT');

    await ensureColumn('avaliacoes', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

    await db.runAsync(`
        UPDATE agendamentos
           SET duracao_horas = COALESCE(duracao_horas, 1),
               horario_fim = COALESCE(
                   horario_fim,
                   DATE_FORMAT(
                       ADDTIME(STR_TO_DATE(horario, '%H:%i'), SEC_TO_TIME(COALESCE(duracao_horas, 1) * 3600)),
                       '%H:%i'
                   )
               ),
               valor_total = COALESCE(valor_total, valor),
               valor_sinal = COALESCE(valor_sinal, valor),
               expires_at = COALESCE(expires_at, DATE_FORMAT(DATE_ADD(created_at, INTERVAL 15 MINUTE), '%Y-%m-%dT%H:%i:%s.000Z'))
         WHERE horario IS NOT NULL
    `);
}

async function ensureDefaultAdmin() {
    const existing = await db.getAsync('SELECT id FROM usuarios WHERE email = ?', ['admin@quadras.com']);
    if (existing) return;

    const hash = await bcrypt.hash('123456', 12);
    await db.runAsync(
        `INSERT INTO usuarios (nome, email, celular, senha, tipo, verificado)
         VALUES (?, ?, ?, ?, 'admin', 1)`,
        ['Administrador', 'admin@quadras.com', '11999990001', hash]
    );

    console.log('Admin padrao criado: admin@quadras.com / 123456');
}

async function seedSampleCourts() {
    const total = await db.getAsync('SELECT COUNT(*) AS total FROM quadras');
    if (Number(total.total) > 0) return;

    await db.runAsync(
        `INSERT INTO quadras (nome, tipo, preco_hora, descricao, status)
         VALUES (?, ?, ?, ?, ?)`,
        ['Arena Society Premium', 'Society', 120, 'Gramado sintetico, iluminacao profissional e vestiarios.', 'disponivel']
    );

    await db.runAsync(
        `INSERT INTO quadras (nome, tipo, preco_hora, descricao, status)
         VALUES (?, ?, ?, ?, ?)`,
        ['Quadra Beach Sports', 'Beach Tennis', 90, 'Areia tratada, redes oficiais e area coberta para descanso.', 'disponivel']
    );
}

db.ready = (async () => {
    await createDatabaseIfNeeded();
    await createSchema();
    await migrateSchema();
    await ensureDefaultAdmin();
    await seedSampleCourts();
    console.log(`MySQL conectado em ${connectionConfig.host}:${connectionConfig.port}/${database}`);
})();

module.exports = db;
