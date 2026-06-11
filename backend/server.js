const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const QRCode = require('qrcode');
const fs = require('fs');
const nodemailer = require('nodemailer');

const db = require('./db');
const auth = require('./auth');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const PAYMENT_LIMIT_MINUTES = Number(process.env.PAYMENT_LIMIT_MINUTES || 15);
const DEPOSIT_PERCENT = 50;
const OPEN_HOUR = Number(process.env.OPEN_HOUR || 6);
const CLOSE_HOUR = Number(process.env.CLOSE_HOUR || 23);
const PIX_KEY_DISPLAY = '(19) 98755-7577';
const PIX_KEY = process.env.PIX_KEY || '+5519987557577';
const PIX_RECEIVER = process.env.PIX_RECEIVER || 'Quadras Pro';
const PIX_CITY = process.env.PIX_CITY || 'SAO PAULO';
const APP_URL = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'Quadras Pro <no-reply@quadraspro.com>';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

const frontendDir = path.join(__dirname, '../frontend');
const uploadsDir = path.join(__dirname, '../uploads');
const courtUploadsDir = path.join(uploadsDir, 'quadras');
const proofUploadsDir = path.join(uploadsDir, 'comprovantes');

fs.mkdirSync(courtUploadsDir, { recursive: true });
fs.mkdirSync(proofUploadsDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(frontendDir));
app.use('/uploads', express.static(uploadsDir));

function sanitizeFilename(filename) {
    const ext = path.extname(filename || '').toLowerCase();
    const base = path.basename(filename || 'arquivo', ext)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 48) || 'arquivo';

    return `${Date.now()}-${base}${ext}`;
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, file.fieldname === 'quadra_imagem' ? courtUploadsDir : proofUploadsDir);
    },
    filename: (req, file, cb) => cb(null, sanitizeFilename(file.originalname))
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'quadra_imagem' && !file.mimetype.startsWith('image/')) {
            cb(new Error('A imagem da quadra precisa ser um arquivo de imagem.'));
            return;
        }

        if (file.fieldname === 'comprovante') {
            const isAllowed = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
            if (!isAllowed) {
                cb(new Error('O comprovante precisa ser imagem ou PDF.'));
                return;
            }
        }

        cb(null, true);
    }
});

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function sendError(res, status, message) {
    return res.status(status).json({ sucesso: false, error: message });
}

let mailTransporter = null;

function getMailTransporter() {
    if (mailTransporter) return mailTransporter;
    if (!process.env.SMTP_HOST) return null;

    const config = {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true'
    };

    if (process.env.SMTP_USER || process.env.SMTP_PASS) {
        config.auth = {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        };
    }

    mailTransporter = nodemailer.createTransport(config);
    return mailTransporter;
}

async function sendMail({ to, subject, text, html }) {
    const recipients = Array.isArray(to)
        ? to.filter(Boolean)
        : String(to || '').split(',').map((item) => item.trim()).filter(Boolean);

    if (!recipients.length) {
        console.warn('Email nao enviado: nenhum destinatario configurado.');
        return false;
    }

    const transporter = getMailTransporter();
    if (!transporter) {
        console.warn(`Email nao enviado para ${recipients.join(', ')}: SMTP_HOST nao configurado.`);
        return false;
    }

    try {
        await transporter.sendMail({
            from: MAIL_FROM,
            to: recipients.join(', '),
            subject,
            text,
            html
        });
        return true;
    } catch (err) {
        console.error('Falha ao enviar email:', err.message);
        return false;
    }
}

function formatDateBR(date) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return date || '-';
    const [year, month, day] = String(date).split('-');
    return `${day}/${month}/${year}`;
}

function formatMoneyBR(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function formatDateTimeLocal(date = new Date()) {
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: APP_TIMEZONE,
        dateStyle: 'short',
        timeStyle: 'short'
    }).format(date);
}

function absoluteUrl(pathname) {
    if (!pathname) return '';
    if (/^https?:\/\//i.test(pathname)) return pathname;
    return APP_URL ? `${APP_URL}${pathname}` : pathname;
}

async function adminEmailRecipients() {
    if (ADMIN_EMAIL) return ADMIN_EMAIL.split(',').map((email) => email.trim()).filter(Boolean);

    const admins = await db.allAsync("SELECT email FROM usuarios WHERE tipo = 'admin'");
    return admins.map((admin) => admin.email).filter(Boolean);
}

function bookingSummary(booking) {
    return [
        `Reserva: #${booking.id}`,
        `Cliente: ${booking.cliente_nome || 'Cliente'}`,
        booking.cliente_email ? `Email: ${booking.cliente_email}` : '',
        `Quadra: ${booking.quadra_nome || '-'}`,
        `Data: ${formatDateBR(booking.data)}`,
        `Horario: ${booking.horario || '-'}${booking.horario_fim ? ` ate ${booking.horario_fim}` : ''}`,
        `Sinal: ${formatMoneyBR(booking.valor_sinal || booking.valor)}`
    ].filter(Boolean).join('\n');
}

async function sendProofReceivedEmail(booking) {
    const proofUrl = absoluteUrl(booking.comprovante);
    const adminUrl = APP_URL ? `${APP_URL}/admin.html` : '';
    const text = [
        'Um cliente enviou um comprovante de pagamento.',
        `Recebido em: ${formatDateTimeLocal()} (horario de Campinas/SP)`,
        '',
        bookingSummary(booking),
        proofUrl ? `Comprovante: ${proofUrl}` : '',
        adminUrl ? `Painel admin: ${adminUrl}` : ''
    ].filter(Boolean).join('\n');

    await sendMail({
        to: await adminEmailRecipients(),
        subject: `Comprovante recebido - reserva #${booking.id}`,
        text,
        html: text.replace(/\n/g, '<br>')
    });
}

async function sendBookingApprovedEmail(booking) {
    if (!booking.cliente_email) return false;

    const text = [
        `Ola, ${booking.cliente_nome || 'cliente'}!`,
        '',
        'Seu comprovante foi aprovado e sua reserva esta confirmada.',
        `Confirmado em: ${formatDateTimeLocal()} (horario de Campinas/SP)`,
        '',
        bookingSummary(booking),
        booking.observacao ? `Observacao: ${booking.observacao}` : ''
    ].filter(Boolean).join('\n');

    return sendMail({
        to: booking.cliente_email,
        subject: `Reserva confirmada - #${booking.id}`,
        text,
        html: text.replace(/\n/g, '<br>')
    });
}

async function authMiddleware(req, res, next) {
    try {
        const raw = req.headers.authorization || '';
        const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
        if (!token) return sendError(res, 401, 'Faça login para continuar.');

        req.user = await auth.verificarToken(token);
        next();
    } catch (err) {
        sendError(res, 401, 'Sessão inválida. Entre novamente.');
    }
}

function adminMiddleware(req, res, next) {
    if (req.user?.tipo !== 'admin') {
        sendError(res, 403, 'Acesso restrito ao administrador.');
        return;
    }

    next();
}

function todayLocal() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function minutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseTime(horario) {
    const match = String(horario || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return hours * 60 + minutes;
}

function normalizeTime(horario) {
    const minutes = parseTime(horario);
    return minutes === null ? null : minutesToTime(minutes);
}

function parseDuration(value) {
    const duration = Number(value || 1);
    return [1, 2].includes(duration) ? duration : null;
}

function validateScheduleInput({ data, horario, duracao_horas }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) {
        throw new Error('Informe uma data válida.');
    }

    if (data < todayLocal()) {
        throw new Error('A data precisa ser hoje ou futura.');
    }

    const horarioNormalizado = normalizeTime(horario);
    const start = parseTime(horarioNormalizado);
    if (start === null) {
        throw new Error('Informe um horário válido.');
    }

    if (start % 60 !== 0) {
        throw new Error('Os agendamentos devem começar em horários cheios.');
    }

    const duration = parseDuration(duracao_horas);
    if (!duration) {
        throw new Error('Escolha 1 hora ou 2 horas.');
    }

    const end = start + duration * 60;
    if (start < OPEN_HOUR * 60 || end > CLOSE_HOUR * 60) {
        throw new Error(`Escolha um horário entre ${minutesToTime(OPEN_HOUR * 60)} e ${minutesToTime(CLOSE_HOUR * 60)}.`);
    }

    const startDateTime = new Date(`${data}T${horarioNormalizado}:00`);
    if (Number.isNaN(startDateTime.getTime())) {
        throw new Error('Data ou horário inválido.');
    }

    if (startDateTime <= new Date()) {
        throw new Error('Escolha um horário futuro.');
    }

    return {
        data,
        horario: horarioNormalizado,
        duracao_horas: duration,
        horario_fim: minutesToTime(end),
        start,
        end
    };
}

function intervalsOverlap(startA, endA, startB, endB) {
    return startA < endB && endA > startB;
}

function intervalFromRow(row) {
    const start = parseTime(row.horario);
    const duration = parseDuration(row.duracao_horas) || 1;
    return {
        start,
        end: parseTime(row.horario_fim) || start + duration * 60
    };
}

function money(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function onlyAscii(value, maxLength) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .trim()
        .toUpperCase()
        .slice(0, maxLength);
}

function emvField(id, value) {
    const text = String(value || '');
    return `${id}${String(text.length).padStart(2, '0')}${text}`;
}

function crc16(payload) {
    let crc = 0xffff;

    for (let index = 0; index < payload.length; index += 1) {
        crc ^= payload.charCodeAt(index) << 8;

        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            crc &= 0xffff;
        }
    }

    return crc.toString(16).toUpperCase().padStart(4, '0');
}

function buildPixBrCode(booking, court) {
    const txid = `QP${String(booking.id).padStart(8, '0')}`.slice(0, 25);
    const merchantInfo = [
        emvField('00', 'BR.GOV.BCB.PIX'),
        emvField('01', PIX_KEY)
    ].join('');

    const additionalInfo = emvField('05', txid);
    const payloadSemCrc = [
        emvField('00', '01'),
        emvField('26', merchantInfo),
        emvField('52', '0000'),
        emvField('53', '986'),
        emvField('54', money(booking.valor_sinal).toFixed(2)),
        emvField('58', 'BR'),
        emvField('59', onlyAscii(PIX_RECEIVER, 25) || 'QUADRAS PRO'),
        emvField('60', onlyAscii(PIX_CITY, 15) || 'BRASIL'),
        emvField('62', additionalInfo),
        '6304'
    ].join('');

    return `${payloadSemCrc}${crc16(payloadSemCrc)}`;
}

function publicFilePath(file) {
    if (!file) return null;
    const folder = file.fieldname === 'quadra_imagem' ? 'quadras' : 'comprovantes';
    return `/uploads/${folder}/${file.filename}`;
}

async function expirePendingBookings() {
    const nowIso = new Date().toISOString();
    await db.runAsync(`
        UPDATE agendamentos
           SET status = 'expirado'
         WHERE status = 'pendente'
           AND expires_at IS NOT NULL
           AND expires_at <= ?
    `, [nowIso]);
}

async function activeBookingsForCourt(quadraId, data) {
    await expirePendingBookings();
    return db.allAsync(
        `SELECT *
           FROM agendamentos
          WHERE quadra_id = ?
            AND data = ?
            AND status IN ('pendente', 'pago', 'confirmado')`,
        [quadraId, data]
    );
}

async function blockedTimesForCourt(quadraId, data) {
    return db.allAsync(
        `SELECT *
           FROM horarios_bloqueados
          WHERE quadra_id = ?
            AND data = ?`,
        [quadraId, data]
    );
}

async function findScheduleConflict({ quadraId, data, horario, duracao_horas, ignoreBookingId = null }) {
    const start = parseTime(horario);
    const end = start + duracao_horas * 60;
    const bookings = await activeBookingsForCourt(quadraId, data);

    const bookingConflict = bookings.find((booking) => {
        if (ignoreBookingId && Number(booking.id) === Number(ignoreBookingId)) return false;
        const interval = intervalFromRow(booking);
        return interval.start !== null && intervalsOverlap(start, end, interval.start, interval.end);
    });

    if (bookingConflict) {
        return { type: 'booking', item: bookingConflict };
    }

    const blockedTimes = await blockedTimesForCourt(quadraId, data);
    const blockedConflict = blockedTimes.find((blocked) => {
        const interval = intervalFromRow(blocked);
        return interval.start !== null && intervalsOverlap(start, end, interval.start, interval.end);
    });

    if (blockedConflict) {
        return { type: 'blocked', item: blockedConflict };
    }

    return null;
}

async function buildAvailability(quadra, data, duracao_horas) {
    const bookings = await activeBookingsForCourt(quadra.id, data);
    const blockedTimes = await blockedTimesForCourt(quadra.id, data);
    const durationMinutes = duracao_horas * 60;
    const now = new Date();
    const slots = [];

    for (let start = OPEN_HOUR * 60; start + durationMinutes <= CLOSE_HOUR * 60; start += 60) {
        const horario = minutesToTime(start);
        const end = start + durationMinutes;
        const slotDate = new Date(`${data}T${horario}:00`);
        let motivo = '';

        if (quadra.status !== 'disponivel') {
            motivo = 'Quadra indisponível';
        } else if (slotDate <= now) {
            motivo = 'Horário encerrado';
        } else {
            const bookingConflict = bookings.find((booking) => {
                const interval = intervalFromRow(booking);
                return interval.start !== null && intervalsOverlap(start, end, interval.start, interval.end);
            });

            const blockedConflict = blockedTimes.find((blocked) => {
                const interval = intervalFromRow(blocked);
                return interval.start !== null && intervalsOverlap(start, end, interval.start, interval.end);
            });

            if (bookingConflict) motivo = 'Reservado';
            if (blockedConflict) motivo = blockedConflict.motivo || 'Fechado';
        }

        slots.push({
            horario,
            horario_fim: minutesToTime(end),
            disponivel: !motivo,
            motivo
        });
    }

    return slots;
}

async function getCourtWithRating(id) {
    return db.getAsync(
        `SELECT q.*,
                ROUND(COALESCE(AVG(a.nota), 0), 1) AS media_avaliacao,
                COUNT(a.id) AS total_avaliacoes
           FROM quadras q
      LEFT JOIN avaliacoes a ON a.quadra_id = q.id
          WHERE q.id = ?
       GROUP BY q.id`,
        [id]
    );
}

// Paginas
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(frontendDir, 'admin.html')));

app.get('/api/config', (req, res) => {
    res.json({
        deposit_percent: DEPOSIT_PERCENT,
        open_hour: OPEN_HOUR,
        close_hour: CLOSE_HOUR,
        payment_limit_minutes: PAYMENT_LIMIT_MINUTES,
        pix_key_display: PIX_KEY_DISPLAY
    });
});

// Autenticacao
app.post('/api/cadastro', asyncHandler(async (req, res) => {
    const resultado = await auth.cadastrarUsuario(req.body);
    res.json({ sucesso: true, ...resultado });
}));

app.post('/api/login', asyncHandler(async (req, res) => {
    const resultado = await auth.login(req.body.email, req.body.senha);
    res.json(resultado);
}));

// Quadras publicas
app.get('/api/quadras', asyncHandler(async (req, res) => {
    const quadras = await db.allAsync(`
        SELECT q.*,
               ROUND(COALESCE(AVG(a.nota), 0), 1) AS media_avaliacao,
               COUNT(a.id) AS total_avaliacoes
          FROM quadras q
     LEFT JOIN avaliacoes a ON q.id = a.quadra_id
      GROUP BY q.id
      ORDER BY CASE q.status
                   WHEN 'disponivel' THEN 1
                   WHEN 'manutencao' THEN 2
                   ELSE 3
               END,
               q.created_at DESC
    `);

    res.json(quadras);
}));

app.get('/api/quadras/:id/horarios', asyncHandler(async (req, res) => {
    const court = await getCourtWithRating(req.params.id);
    if (!court) return sendError(res, 404, 'Quadra não encontrada.');

    const data = String(req.query.data || todayLocal());
    const duration = parseDuration(req.query.duracao_horas || 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < todayLocal()) {
        return sendError(res, 400, 'Informe uma data válida.');
    }
    if (!duration) return sendError(res, 400, 'Escolha 1 hora ou 2 horas.');

    const horarios = await buildAvailability(court, data, duration);
    res.json({
        quadra_id: court.id,
        data,
        duracao_horas: duration,
        horarios
    });
}));

app.get('/api/quadras/:id/avaliacoes', asyncHandler(async (req, res) => {
    const avaliacoes = await db.allAsync(
        `SELECT id, cliente_nome, nota, comentario, created_at
           FROM avaliacoes
          WHERE quadra_id = ?
       ORDER BY created_at DESC
          LIMIT 50`,
        [req.params.id]
    );

    res.json(avaliacoes);
}));

app.post('/api/quadras/:id/avaliacoes', authMiddleware, asyncHandler(async (req, res) => {
    const quadra = await getCourtWithRating(req.params.id);
    if (!quadra) return sendError(res, 404, 'Quadra não encontrada.');

    const nota = Number(req.body.nota);
    const comentario = String(req.body.comentario || '').trim().slice(0, 600);

    if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
        return sendError(res, 400, 'Escolha uma nota de 1 a 5.');
    }

    const reservaConfirmada = await db.getAsync(
        `SELECT id
           FROM agendamentos
          WHERE quadra_id = ?
            AND usuario_id = ?
            AND status = 'confirmado'
          LIMIT 1`,
        [quadra.id, req.user.id]
    );

    if (!reservaConfirmada) {
        return sendError(res, 403, 'Você pode avaliar depois que uma reserva for confirmada.');
    }

    const existente = await db.getAsync(
        'SELECT id FROM avaliacoes WHERE quadra_id = ? AND usuario_id = ?',
        [quadra.id, req.user.id]
    );

    if (existente) {
        await db.runAsync(
            `UPDATE avaliacoes
                SET nota = ?, comentario = ?, cliente_nome = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [nota, comentario, req.user.nome, existente.id]
        );
    } else {
        await db.runAsync(
            `INSERT INTO avaliacoes (quadra_id, usuario_id, cliente_nome, nota, comentario)
             VALUES (?, ?, ?, ?, ?)`,
            [quadra.id, req.user.id, req.user.nome, nota, comentario]
        );
    }

    res.json({ sucesso: true });
}));

// Agendamentos do cliente
app.post('/api/agendar', authMiddleware, asyncHandler(async (req, res) => {
    const input = validateScheduleInput(req.body);
    const quadra = await getCourtWithRating(req.body.quadra_id);

    if (!quadra) return sendError(res, 404, 'Quadra não encontrada.');
    if (quadra.status !== 'disponivel') return sendError(res, 400, 'Esta quadra não está disponível.');

    const conflict = await findScheduleConflict({
        quadraId: quadra.id,
        data: input.data,
        horario: input.horario,
        duracao_horas: input.duracao_horas
    });

    if (conflict) {
        return sendError(res, 409, conflict.type === 'blocked' ? 'Horário fechado pelo administrador.' : 'Horário já reservado.');
    }

    const valorTotal = money(Number(quadra.preco_hora) * input.duracao_horas);
    const valorSinal = money(valorTotal * (DEPOSIT_PERCENT / 100));
    const expiresAt = new Date(Date.now() + PAYMENT_LIMIT_MINUTES * 60 * 1000).toISOString();

    const result = await db.runAsync(
        `INSERT INTO agendamentos (
            quadra_id, usuario_id, cliente_nome, data, horario, duracao_horas,
            horario_fim, status, valor, valor_total, valor_sinal, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?)`,
        [
            quadra.id,
            req.user.id,
            req.user.nome,
            input.data,
            input.horario,
            input.duracao_horas,
            input.horario_fim,
            valorSinal,
            valorTotal,
            valorSinal,
            expiresAt
        ]
    );

    const booking = {
        id: result.insertId,
        data: input.data,
        horario: input.horario,
        horario_fim: input.horario_fim,
        valor_total: valorTotal,
        valor_sinal: valorSinal,
        expires_at: expiresAt
    };
    const pixPayload = buildPixBrCode(booking, quadra);
    const pixQR = await QRCode.toDataURL(pixPayload, {
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' }
    });

    await db.runAsync(
        'UPDATE agendamentos SET pix_key = ?, pix_qr = ? WHERE id = ?',
        [pixPayload, pixQR, result.insertId]
    );

    res.json({
        sucesso: true,
        id: result.insertId,
        pixQR,
        pixKey: pixPayload,
        pix_key_display: PIX_KEY_DISPLAY,
        valor_total: valorTotal,
        valor_sinal: valorSinal,
        expires_at: expiresAt,
        payment_limit_minutes: PAYMENT_LIMIT_MINUTES
    });
}));

app.get('/api/me/agendamentos', authMiddleware, asyncHandler(async (req, res) => {
    await expirePendingBookings();
    const agendamentos = await db.allAsync(
        `SELECT a.*, q.nome AS quadra_nome, q.tipo AS quadra_tipo, q.imagem AS quadra_imagem
           FROM agendamentos a
           JOIN quadras q ON q.id = a.quadra_id
          WHERE a.usuario_id = ?
       ORDER BY a.created_at DESC
          LIMIT 80`,
        [req.user.id]
    );

    res.json(agendamentos);
}));

app.post('/api/comprovante/:id', authMiddleware, upload.single('comprovante'), asyncHandler(async (req, res) => {
    if (!req.file) return sendError(res, 400, 'Envie o arquivo do comprovante.');

    const agendamento = await db.getAsync('SELECT * FROM agendamentos WHERE id = ?', [req.params.id]);
    if (!agendamento) return sendError(res, 404, 'Agendamento não encontrado.');
    if (Number(agendamento.usuario_id) !== Number(req.user.id) && req.user.tipo !== 'admin') {
        return sendError(res, 403, 'Você não pode alterar este agendamento.');
    }

    if (agendamento.status === 'confirmado') {
        return sendError(res, 400, 'Este agendamento já foi confirmado.');
    }

    if (agendamento.status === 'cancelado' || agendamento.status === 'expirado') {
        return sendError(res, 400, 'Este agendamento não aceita comprovante.');
    }

    if (agendamento.status === 'pendente' && agendamento.expires_at && new Date(agendamento.expires_at) <= new Date()) {
        await db.runAsync("UPDATE agendamentos SET status = 'expirado' WHERE id = ?", [agendamento.id]);
        return sendError(res, 400, 'O prazo de 15 minutos expirou. Faça uma nova reserva.');
    }

    await db.runAsync(
        `UPDATE agendamentos
            SET comprovante = ?,
                status = 'pago',
                pago_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [publicFilePath(req.file), agendamento.id]
    );

    const agendamentoAtualizado = await db.getAsync(`
        SELECT a.*,
               q.nome AS quadra_nome,
               q.tipo AS quadra_tipo,
               u.email AS cliente_email
          FROM agendamentos a
          JOIN quadras q ON q.id = a.quadra_id
     LEFT JOIN usuarios u ON u.id = a.usuario_id
         WHERE a.id = ?
    `, [agendamento.id]);

    await sendProofReceivedEmail(agendamentoAtualizado);

    res.json({ sucesso: true });
}));

// Admin - quadras
app.get('/api/admin/quadras', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const quadras = await db.allAsync(`
        SELECT q.*,
               ROUND(COALESCE(AVG(a.nota), 0), 1) AS media_avaliacao,
               COUNT(a.id) AS total_avaliacoes
          FROM quadras q
     LEFT JOIN avaliacoes a ON q.id = a.quadra_id
      GROUP BY q.id
      ORDER BY q.created_at DESC
    `);

    res.json(quadras);
}));

app.post('/api/admin/quadras', authMiddleware, adminMiddleware, upload.single('quadra_imagem'), asyncHandler(async (req, res) => {
    const nome = String(req.body.nome || '').trim();
    const tipo = String(req.body.tipo || '').trim();
    const descricao = String(req.body.descricao || '').trim();
    const precoHora = Number(req.body.preco_hora);
    const status = ['disponivel', 'manutencao', 'indisponivel'].includes(req.body.status)
        ? req.body.status
        : 'disponivel';

    if (nome.length < 3) return sendError(res, 400, 'Informe o nome da quadra.');
    if (tipo.length < 2) return sendError(res, 400, 'Informe o tipo da quadra.');
    if (!Number.isFinite(precoHora) || precoHora <= 0) return sendError(res, 400, 'Informe um preço por hora válido.');

    const result = await db.runAsync(
        `INSERT INTO quadras (nome, tipo, preco_hora, descricao, imagem, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [nome, tipo, precoHora, descricao, publicFilePath(req.file), status]
    );

    res.json({ sucesso: true, id: result.insertId });
}));

app.put('/api/admin/quadras/:id', authMiddleware, adminMiddleware, upload.single('quadra_imagem'), asyncHandler(async (req, res) => {
    const quadra = await db.getAsync('SELECT * FROM quadras WHERE id = ?', [req.params.id]);
    if (!quadra) return sendError(res, 404, 'Quadra não encontrada.');

    const nome = String(req.body.nome || quadra.nome).trim();
    const tipo = String(req.body.tipo || quadra.tipo).trim();
    const descricao = String(req.body.descricao ?? quadra.descricao ?? '').trim();
    const precoHora = req.body.preco_hora === undefined ? Number(quadra.preco_hora) : Number(req.body.preco_hora);
    const status = ['disponivel', 'manutencao', 'indisponivel'].includes(req.body.status)
        ? req.body.status
        : quadra.status;
    const imagem = req.file ? publicFilePath(req.file) : quadra.imagem;

    if (nome.length < 3) return sendError(res, 400, 'Informe o nome da quadra.');
    if (tipo.length < 2) return sendError(res, 400, 'Informe o tipo da quadra.');
    if (!Number.isFinite(precoHora) || precoHora <= 0) return sendError(res, 400, 'Informe um preço por hora válido.');

    await db.runAsync(
        `UPDATE quadras
            SET nome = ?, tipo = ?, preco_hora = ?, descricao = ?, imagem = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [nome, tipo, precoHora, descricao, imagem, status, quadra.id]
    );

    res.json({ sucesso: true });
}));

app.delete('/api/admin/quadras/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const result = await db.runAsync('DELETE FROM quadras WHERE id = ?', [req.params.id]);
    if (!result.changes) return sendError(res, 404, 'Quadra não encontrada.');
    res.json({ sucesso: true });
}));

// Admin - agendamentos
app.get('/api/admin/agendamentos', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    await expirePendingBookings();
    const agendamentos = await db.allAsync(`
        SELECT a.*,
               q.nome AS quadra_nome,
               q.tipo AS quadra_tipo,
               u.email AS cliente_email,
               u.celular AS cliente_celular
          FROM agendamentos a
          JOIN quadras q ON a.quadra_id = q.id
     LEFT JOIN usuarios u ON a.usuario_id = u.id
      ORDER BY a.created_at DESC
         LIMIT 200
    `);

    res.json(agendamentos);
}));

app.put('/api/admin/agendamentos/:id/status', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const status = String(req.body.status || '');
    const observacao = String(req.body.observacao || '').trim();
    if (!['confirmado', 'cancelado'].includes(status)) {
        return sendError(res, 400, 'Status inválido.');
    }

    const agendamento = await db.getAsync('SELECT * FROM agendamentos WHERE id = ?', [req.params.id]);
    if (!agendamento) return sendError(res, 404, 'Agendamento não encontrado.');

    if (status === 'confirmado' && !agendamento.comprovante) {
        return sendError(res, 400, 'Só é possível confirmar depois do comprovante.');
    }

    await db.runAsync(
        `UPDATE agendamentos
            SET status = ?,
                observacao = ?,
                confirmado_at = CASE WHEN ? = 'confirmado' THEN CURRENT_TIMESTAMP ELSE confirmado_at END
          WHERE id = ?`,
        [status, observacao, status, agendamento.id]
    );

    if (status === 'confirmado') {
        const agendamentoAtualizado = await db.getAsync(`
            SELECT a.*,
                   q.nome AS quadra_nome,
                   q.tipo AS quadra_tipo,
                   u.email AS cliente_email
              FROM agendamentos a
              JOIN quadras q ON q.id = a.quadra_id
         LEFT JOIN usuarios u ON u.id = a.usuario_id
             WHERE a.id = ?
        `, [agendamento.id]);

        await sendBookingApprovedEmail(agendamentoAtualizado);
    }

    res.json({ sucesso: true });
}));

// Admin - avaliacoes
app.get('/api/admin/avaliacoes', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const avaliacoes = await db.allAsync(`
        SELECT a.*,
               q.nome AS quadra_nome,
               q.tipo AS quadra_tipo,
               u.email AS cliente_email
          FROM avaliacoes a
          JOIN quadras q ON q.id = a.quadra_id
     LEFT JOIN usuarios u ON u.id = a.usuario_id
      ORDER BY a.created_at DESC
         LIMIT 200
    `);

    res.json(avaliacoes);
}));

app.delete('/api/admin/avaliacoes/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const result = await db.runAsync('DELETE FROM avaliacoes WHERE id = ?', [req.params.id]);
    if (!result.changes) return sendError(res, 404, 'Avaliacao nao encontrada.');
    res.json({ sucesso: true });
}));

// Admin - bloqueios de horario
app.get('/api/admin/bloqueios', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const bloqueios = await db.allAsync(`
        SELECT b.*, q.nome AS quadra_nome
          FROM horarios_bloqueados b
          JOIN quadras q ON q.id = b.quadra_id
      ORDER BY b.data DESC, b.horario DESC
         LIMIT 200
    `);

    res.json(bloqueios);
}));

app.post('/api/admin/bloqueios', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const input = validateScheduleInput(req.body);
    const quadra = await getCourtWithRating(req.body.quadra_id);
    if (!quadra) return sendError(res, 404, 'Quadra não encontrada.');

    const conflict = await findScheduleConflict({
        quadraId: quadra.id,
        data: input.data,
        horario: input.horario,
        duracao_horas: input.duracao_horas
    });

    if (conflict) {
        return sendError(res, 409, conflict.type === 'booking' ? 'Já existe uma reserva nesse período.' : 'Já existe um bloqueio nesse período.');
    }

    const motivo = String(req.body.motivo || 'Horário fechado').trim().slice(0, 120);
    const result = await db.runAsync(
        `INSERT INTO horarios_bloqueados (quadra_id, data, horario, duracao_horas, horario_fim, motivo)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [quadra.id, input.data, input.horario, input.duracao_horas, input.horario_fim, motivo]
    );

    res.json({ sucesso: true, id: result.insertId });
}));

app.delete('/api/admin/bloqueios/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const result = await db.runAsync('DELETE FROM horarios_bloqueados WHERE id = ?', [req.params.id]);
    if (!result.changes) return sendError(res, 404, 'Bloqueio não encontrado.');
    res.json({ sucesso: true });
}));

app.use('/api', (req, res) => sendError(res, 404, 'Rota não encontrada.'));
app.use((err, req, res, next) => {
    console.error(err);
    sendError(res, 500, err.message || 'Erro interno.');
});
app.use('*', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

db.ready
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Quadras Pro rodando em http://localhost:${PORT}`);
            console.log(`Admin: http://localhost:${PORT}/admin`);
            console.log('Login admin padrao: admin@quadras.com / 123456');
        });
    })
    .catch((err) => {
        console.error('Erro ao inicializar banco:', err);
        process.exit(1);
    });

module.exports = app;
