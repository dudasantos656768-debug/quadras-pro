-- Script MySQL para o Quadras Pro.
-- Cole e execute no MySQL Workbench conectado em Local instance MySQL80.
-- Usuario usado pelo app: root
-- Senha usada pelo app: ifsp

CREATE DATABASE IF NOT EXISTS quadras_pro
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE quadras_pro;

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

INSERT IGNORE INTO usuarios (id, nome, email, celular, senha, tipo, verificado)
VALUES (
    1,
    'Administrador',
    'admin@quadras.com',
    '11999990001',
    '$2b$12$NX9r5nH3c4hm8WtDT2cBpOX9mBprxqBuyGlbLXN7VCDuQ.k7TvM8.',
    'admin',
    1
);

INSERT INTO quadras (nome, tipo, preco_hora, descricao, status)
SELECT 'Arena Society Premium',
       'Society',
       120.00,
       'Gramado sintetico, iluminacao profissional e vestiarios.',
       'disponivel'
WHERE NOT EXISTS (
    SELECT 1 FROM quadras WHERE nome = 'Arena Society Premium'
);

INSERT INTO quadras (nome, tipo, preco_hora, descricao, status)
SELECT 'Quadra Beach Sports',
       'Beach Tennis',
       90.00,
       'Areia tratada, redes oficiais e area coberta para descanso.',
       'disponivel'
WHERE NOT EXISTS (
    SELECT 1 FROM quadras WHERE nome = 'Quadra Beach Sports'
);
