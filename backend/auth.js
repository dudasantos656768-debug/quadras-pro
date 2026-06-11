const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');

const SECRET = process.env.JWT_SECRET || 'QUADRAS_PRO_LOCAL_SECRET';

function normalizarEmail(email = '') {
    return String(email).trim().toLowerCase();
}

function normalizarCelular(celular = '') {
    return String(celular).replace(/\D/g, '');
}

async function cadastrarUsuario(dados) {
    const nome = String(dados.nome || '').trim();
    const email = normalizarEmail(dados.email);
    const celular = normalizarCelular(dados.celular);
    const senha = String(dados.senha || '');

    if (nome.length < 3) {
        throw new Error('Informe seu nome completo.');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Informe um email valido.');
    }

    if (!/^\d{10,11}$/.test(celular)) {
        throw new Error('Informe um celular com DDD.');
    }

    if (senha.length < 6) {
        throw new Error('A senha precisa ter pelo menos 6 caracteres.');
    }

    const existente = await db.getAsync(
        'SELECT id FROM usuarios WHERE email = ? OR celular = ?',
        [email, celular]
    );

    if (existente) {
        throw new Error('Email ou celular ja cadastrado.');
    }

    const senhaHash = await bcrypt.hash(senha, 12);
    const result = await db.runAsync(
        `INSERT INTO usuarios (nome, email, celular, senha, tipo, verificado)
         VALUES (?, ?, ?, ?, 'cliente', 1)`,
        [nome, email, celular, senhaHash]
    );

    return {
        id: result.insertId,
        mensagem: 'Cadastro criado com sucesso. Voce ja pode entrar.'
    };
}

async function login(emailInformado, senha) {
    const email = normalizarEmail(emailInformado);
    const usuario = await db.getAsync('SELECT * FROM usuarios WHERE email = ?', [email]);

    if (!usuario) {
        throw new Error('Email nao encontrado.');
    }

    const senhaOk = await bcrypt.compare(String(senha || ''), usuario.senha);
    if (!senhaOk) {
        throw new Error('Senha incorreta.');
    }

    const token = jwt.sign(
        {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            tipo: usuario.tipo || 'cliente'
        },
        SECRET,
        { expiresIn: '7d' }
    );

    return {
        token,
        usuario: {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            tipo: usuario.tipo || 'cliente',
            celular: usuario.celular
        }
    };
}

async function verificarToken(token) {
    return jwt.verify(token, SECRET);
}

module.exports = {
    cadastrarUsuario,
    login,
    verificarToken,
    SECRET
};
