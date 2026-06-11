const API = '/api';

let token = localStorage.getItem('token');
let usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
let appConfig = {
    deposit_percent: 50,
    open_hour: 6,
    close_hour: 23,
    payment_limit_minutes: 15
};

let quadrasCache = [];
let adminQuadrasCache = [];
let adminAgendamentosCache = [];
let adminBloqueiosCache = [];
let adminAvaliacoesCache = [];
let minhasReservasCache = [];
let pixCountdownTimer = null;

function $(id) {
    return document.getElementById(id);
}

function isAdminPage() {
    return window.location.pathname.includes('/admin');
}

function authHeaders(extra = {}) {
    return token ? { ...extra, Authorization: token } : extra;
}

async function apiFetch(path, options = {}) {
    const resp = await fetch(`${API}${path}`, options);
    const contentType = resp.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await resp.json() : await resp.text();

    if (!resp.ok) {
        const message = typeof data === 'object' ? data.error : data;
        throw new Error(message || 'Não foi possível concluir a ação.');
    }

    return data;
}

function escapeHTML(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatCurrency(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function formatDateBR(value) {
    if (!value) return '-';
    const [year, month, day] = String(value).split('-');
    return `${day}/${month}/${year}`;
}

function formatDateTimeBR(value) {
    if (!value) return '-';
    return new Date(value).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short'
    });
}

function todayISO() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function statusLabel(status) {
    const labels = {
        disponivel: 'Disponível',
        manutencao: 'Manutenção',
        indisponivel: 'Indisponível',
        pendente: 'Pendente',
        pago: 'Comprovante enviado',
        confirmado: 'Confirmado',
        cancelado: 'Cancelado',
        expirado: 'Expirado'
    };

    return labels[status] || status || '-';
}

function showAlert(message, type = 'success') {
    let stack = document.querySelector('.notice-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.className = 'notice-stack';
        document.body.appendChild(stack);
    }

    const item = document.createElement('div');
    item.className = `notice notice-${type}`;
    item.innerHTML = `
        <span>${escapeHTML(message)}</span>
        <button type="button" aria-label="Fechar">&times;</button>
    `;
    item.querySelector('button').addEventListener('click', () => item.remove());
    stack.appendChild(item);
    setTimeout(() => item.remove(), 5200);
}

function modal(id) {
    const element = $(id);
    return element ? bootstrap.Modal.getOrCreateInstance(element) : null;
}

async function carregarConfig() {
    try {
        appConfig = await apiFetch('/config');
    } catch {
        // Mantem os padroes locais se a rota nao responder.
    }
}

function aplicarMascaraCelular(input) {
    let valor = input.value.replace(/\D/g, '');
    valor = valor.replace(/(\d{2})(\d)/, '($1) $2');
    valor = valor.replace(/(\d{4,5})(\d{4})$/, '$1-$2');
    input.value = valor.slice(0, 15);
}

function atualizarNavbar() {
    const navbar = $('navbarAuth');
    if (!navbar) return;

    if (!usuario) {
        navbar.innerHTML = `
            <button class="btn btn-soft" type="button" data-bs-toggle="modal" data-bs-target="#loginModal">
                <i class="fa-solid fa-right-to-bracket"></i>
                Entrar
            </button>
            <button class="btn btn-primary-action" type="button" data-bs-toggle="modal" data-bs-target="#cadastroModal">
                <i class="fa-solid fa-user-plus"></i>
                Cadastrar
            </button>
        `;
        return;
    }

    navbar.innerHTML = `
        <span class="nav-user">
            <i class="fa-solid fa-circle-user"></i>
            ${escapeHTML(usuario.nome)}
        </span>
        ${usuario.tipo === 'admin' ? `
            <a href="/admin" class="btn btn-soft">
                <i class="fa-solid fa-shield-halved"></i>
                Admin
            </a>
        ` : ''}
    `;
}

function atualizarStatusUsuario() {
    const strip = $('statusUsuario');
    if (!strip) return;

    if (!usuario) {
        strip.classList.add('d-none');
        return;
    }

    $('nomeUsuario').textContent = usuario.nome;
    $('emailUsuario').textContent = usuario.email;
    strip.classList.remove('d-none');
}

async function handleCadastro(event) {
    event.preventDefault();
    const dados = {
        nome: $('cadastroNome').value,
        email: $('cadastroEmail').value,
        celular: $('cadastroCelular').value,
        senha: $('cadastroSenha').value
    };

    try {
        await apiFetch('/cadastro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });

        const login = await apiFetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: dados.email, senha: dados.senha })
        });

        token = login.token;
        usuario = login.usuario;
        localStorage.setItem('token', token);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        modal('cadastroModal')?.hide();
        atualizarNavbar();
        atualizarStatusUsuario();
        showAlert('Conta criada. Bem-vindo ao Quadras Pro.');
        carregarQuadras();
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

async function handleLogin(event) {
    event.preventDefault();

    try {
        const result = await apiFetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: $('loginEmail').value,
                senha: $('loginSenha').value
            })
        });

        token = result.token;
        usuario = result.usuario;
        localStorage.setItem('token', token);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        modal('loginModal')?.hide();
        atualizarNavbar();
        atualizarStatusUsuario();
        showAlert(`Bem-vindo, ${usuario.nome}.`);

        if (isAdminPage()) {
            iniciarAdmin();
        } else {
            carregarQuadras();
        }
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    token = null;
    usuario = null;
    if (isAdminPage()) {
        window.location.href = '/';
        return;
    }

    atualizarNavbar();
    atualizarStatusUsuario();
    carregarQuadras();
}

function ratingHTML(media, total) {
    if (!Number(total)) return '<span class="muted-text">Sem avaliações</span>';

    return `
        <span class="rating-line">
            <i class="fa-solid fa-star"></i>
            <strong>${Number(media || 0).toFixed(1)}</strong>
            <small>${Number(total)} avaliação${Number(total) === 1 ? '' : 'ões'}</small>
        </span>
    `;
}

function imageHTML(quadra, className = 'court-image') {
    if (quadra.imagem) {
        return `<img class="${className}" src="${escapeHTML(quadra.imagem)}" alt="${escapeHTML(quadra.nome)}">`;
    }

    return `
        <div class="${className} image-placeholder">
            <i class="fa-solid fa-image"></i>
            <span>Foto da quadra</span>
        </div>
    `;
}

function renderQuadras() {
    const container = $('listaQuadras');
    if (!container) return;

    const busca = ($('filtroBusca')?.value || '').trim().toLowerCase();
    const status = $('filtroStatus')?.value || '';
    const quadras = quadrasCache.filter((quadra) => {
        const matchesSearch = `${quadra.nome} ${quadra.tipo} ${quadra.descricao || ''}`.toLowerCase().includes(busca);
        const matchesStatus = !status || quadra.status === status;
        return matchesSearch && matchesStatus;
    });

    if (!quadras.length) {
        container.innerHTML = `
            <div class="col-12">
                <div class="empty-state">
                    <i class="fa-regular fa-calendar-xmark"></i>
                    <strong>Nenhuma quadra encontrada</strong>
                    <span>Ajuste os filtros ou tente novamente mais tarde.</span>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = quadras.map((quadra) => `
        <div class="col-xl-4 col-md-6">
            <article class="court-card">
                ${imageHTML(quadra)}
                <div class="court-card-body">
                    <div class="court-card-top">
                        <span class="status-chip status-${escapeHTML(quadra.status)}">${statusLabel(quadra.status)}</span>
                        <span class="court-type">${escapeHTML(quadra.tipo)}</span>
                    </div>
                    <h3>${escapeHTML(quadra.nome)}</h3>
                    <p>${escapeHTML(quadra.descricao || 'Quadra cadastrada para agendamento online.')}</p>
                    <div class="court-meta">
                        <span>
                            <i class="fa-solid fa-money-bill-wave"></i>
                            ${formatCurrency(quadra.preco_hora)}/hora
                        </span>
                        ${ratingHTML(quadra.media_avaliacao, quadra.total_avaliacoes)}
                    </div>
                    <div class="court-actions">
                        <button class="btn btn-primary-action" type="button" onclick="abrirAgendamento(${quadra.id})" ${quadra.status !== 'disponivel' ? 'disabled' : ''}>
                            <i class="fa-solid fa-calendar-plus"></i>
                            Agendar
                        </button>
                        <button class="btn btn-soft" type="button" onclick="abrirAvaliacoes(${quadra.id})">
                            <i class="fa-solid fa-star"></i>
                            Avaliações
                        </button>
                    </div>
                </div>
            </article>
        </div>
    `).join('');
}

async function carregarQuadras() {
    const container = $('listaQuadras');
    if (container) {
        container.innerHTML = '<div class="col-12"><div class="loading-line">Carregando quadras...</div></div>';
    }

    try {
        quadrasCache = await apiFetch('/quadras');
        renderQuadras();
    } catch (err) {
        if (container) {
            container.innerHTML = `
                <div class="col-12">
                    <div class="empty-state">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <strong>Não foi possível carregar as quadras</strong>
                        <span>${escapeHTML(err.message)}</span>
                    </div>
                </div>
            `;
        }
    }
}

function duracaoSelecionada() {
    return Number(document.querySelector('input[name="duracaoAgendamento"]:checked')?.value || 1);
}

function atualizarResumoReserva() {
    const preco = Number($('precoHoraAgendar')?.value || 0);
    const duracao = duracaoSelecionada();
    const total = preco * duracao;
    const sinal = total * (Number(appConfig.deposit_percent || 50) / 100);

    if ($('valorTotalReserva')) $('valorTotalReserva').textContent = formatCurrency(total);
    if ($('valorSinalReserva')) $('valorSinalReserva').textContent = formatCurrency(sinal);
}

async function carregarHorariosDisponiveis() {
    const quadraId = $('quadraIdAgendar')?.value;
    const data = $('dataAgendamento')?.value;
    const duracao = duracaoSelecionada();
    const container = $('horariosDisponiveis');
    if (!quadraId || !data || !container) return;

    $('horarioSelecionado').value = '';
    $('btnConfirmarAgendamento').disabled = true;
    container.innerHTML = '<div class="loading-line">Carregando horários...</div>';
    atualizarResumoReserva();

    try {
        const result = await apiFetch(`/quadras/${quadraId}/horarios?data=${encodeURIComponent(data)}&duracao_horas=${duracao}`);
        container.innerHTML = result.horarios.map((slot) => `
            <button class="slot-button" type="button" ${slot.disponivel ? '' : 'disabled'} onclick="selecionarHorario('${slot.horario}')">
                <strong>${slot.horario}</strong>
                <small>${slot.disponivel ? `até ${slot.horario_fim}` : escapeHTML(slot.motivo)}</small>
            </button>
        `).join('');
    } catch (err) {
        container.innerHTML = `<div class="empty-state compact">${escapeHTML(err.message)}</div>`;
    }
}

function selecionarHorario(horario) {
    $('horarioSelecionado').value = horario;
    document.querySelectorAll('.slot-button').forEach((button) => {
        button.classList.toggle('selected', button.querySelector('strong')?.textContent === horario);
    });
    $('btnConfirmarAgendamento').disabled = false;
}

function abrirAgendamento(id) {
    if (!usuario) {
        showAlert('Entre na sua conta para reservar.', 'warning');
        modal('loginModal')?.show();
        return;
    }

    const quadra = quadrasCache.find((item) => Number(item.id) === Number(id));
    if (!quadra || quadra.status !== 'disponivel') {
        showAlert('Esta quadra não está disponível para reserva.', 'warning');
        return;
    }

    $('quadraIdAgendar').value = quadra.id;
    $('precoHoraAgendar').value = quadra.preco_hora;
    $('horarioSelecionado').value = '';
    $('nomeQuadraModal').textContent = quadra.nome;
    $('dataAgendamento').min = todayISO();
    $('dataAgendamento').value = todayISO();
    $('duracao1').checked = true;
    $('btnConfirmarAgendamento').disabled = true;
    atualizarResumoReserva();
    carregarHorariosDisponiveis();
    modal('agendarModal')?.show();
}

async function confirmarAgendamento() {
    const dados = {
        quadra_id: Number($('quadraIdAgendar').value),
        data: $('dataAgendamento').value,
        horario: $('horarioSelecionado').value,
        duracao_horas: duracaoSelecionada()
    };

    if (!dados.horario) {
        showAlert('Selecione um horário disponível.', 'warning');
        return;
    }

    try {
        const result = await apiFetch('/agendar', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(dados)
        });

        modal('agendarModal')?.hide();
        abrirPagamento(result);
        carregarQuadras();
    } catch (err) {
        showAlert(err.message, 'danger');
        carregarHorariosDisponiveis();
    }
}

function abrirPagamento(agendamento) {
    $('agendamentoId').textContent = agendamento.id;
    $('valorPix').textContent = formatCurrency(agendamento.valor_sinal);
    $('pixQR').innerHTML = `<img src="${escapeHTML(agendamento.pixQR || agendamento.pix_qr)}" alt="QR Code PIX">`;
    if ($('pixCopyPaste')) {
        $('pixCopyPaste').value = agendamento.pixKey || agendamento.pix_key || '';
    }
    $('comprovanteFile').value = '';
    modal('pixModal')?.show();
    iniciarContadorPix(agendamento.expires_at);
}

async function copiarPix() {
    const campo = $('pixCopyPaste');
    if (!campo?.value) {
        showAlert('Código PIX indisponível.', 'warning');
        return;
    }

    try {
        await navigator.clipboard.writeText(campo.value);
        showAlert('Código PIX copiado.');
    } catch {
        campo.select();
        document.execCommand('copy');
        showAlert('Código PIX copiado.');
    }
}

function iniciarContadorPix(expiresAt) {
    clearInterval(pixCountdownTimer);
    const countdown = $('pixCountdown');
    const file = $('comprovanteFile');

    function tick() {
        const diff = new Date(expiresAt).getTime() - Date.now();
        if (diff <= 0) {
            countdown.textContent = 'Expirado';
            file.disabled = true;
            clearInterval(pixCountdownTimer);
            return;
        }

        file.disabled = false;
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        countdown.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    tick();
    pixCountdownTimer = setInterval(tick, 1000);
}

async function enviarComprovante() {
    const id = $('agendamentoId').textContent;
    const file = $('comprovanteFile').files[0];
    if (!file) {
        showAlert('Selecione o comprovante do pagamento.', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('comprovante', file);

    try {
        await apiFetch(`/comprovante/${id}`, {
            method: 'POST',
            headers: authHeaders(),
            body: formData
        });

        modal('pixModal')?.hide();
        showAlert('Comprovante enviado. Aguarde a confirmação do administrador.');
        carregarMinhasReservas();
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

async function carregarMinhasReservas() {
    const container = $('listaMinhasReservas');
    if (!token) {
        showAlert('Entre na sua conta para ver suas reservas.', 'warning');
        modal('reservasModal')?.hide();
        modal('loginModal')?.show();
        return;
    }

    if (!container) return;

    container.innerHTML = '<div class="loading-line">Carregando reservas...</div>';

    try {
        minhasReservasCache = await apiFetch('/me/agendamentos', {
            headers: authHeaders()
        });

        if (!minhasReservasCache.length) {
            container.innerHTML = `
                <div class="empty-state compact">
                    <i class="fa-regular fa-calendar"></i>
                    <strong>Você ainda não tem reservas</strong>
                </div>
            `;
            return;
        }

        container.innerHTML = minhasReservasCache.map((item) => {
            const canPay = item.status === 'pendente' && new Date(item.expires_at) > new Date();
            const canReview = item.status === 'confirmado';
            return `
                <article class="reservation-item">
                    ${imageHTML({ nome: item.quadra_nome, imagem: item.quadra_imagem }, 'reservation-image')}
                    <div class="reservation-main">
                        <div class="reservation-title">
                            <h3>${escapeHTML(item.quadra_nome)}</h3>
                            <span class="status-chip status-${escapeHTML(item.status)}">${statusLabel(item.status)}</span>
                        </div>
                        <p>${formatDateBR(item.data)} · ${escapeHTML(item.horario)} às ${escapeHTML(item.horario_fim || '')} · ${item.duracao_horas}h</p>
                        <div class="reservation-values">
                            <span>Total: <b>${formatCurrency(item.valor_total)}</b></span>
                            <span>Sinal: <b>${formatCurrency(item.valor_sinal)}</b></span>
                            ${item.expires_at ? `<span>Prazo: <b>${formatDateTimeBR(item.expires_at)}</b></span>` : ''}
                        </div>
                    </div>
                    <div class="reservation-actions">
                        ${canPay ? `
                            <button class="btn btn-primary-action btn-sm" type="button" onclick="abrirPagamentoReserva(${item.id})">
                                <i class="fa-solid fa-qrcode"></i>
                                Pagar sinal
                            </button>
                        ` : ''}
                        ${canReview ? `
                            <button class="btn btn-soft btn-sm" type="button" onclick="abrirAvaliacoes(${item.quadra_id})">
                                <i class="fa-solid fa-star"></i>
                                Avaliar
                            </button>
                        ` : ''}
                    </div>
                </article>
            `;
        }).join('');
    } catch (err) {
        container.innerHTML = `<div class="empty-state compact">${escapeHTML(err.message)}</div>`;
    }
}

function abrirPagamentoReserva(id) {
    const reserva = minhasReservasCache.find((item) => Number(item.id) === Number(id));
    if (!reserva) return;
    abrirPagamento({
        id: reserva.id,
        valor_sinal: reserva.valor_sinal,
        pixQR: reserva.pix_qr,
        expires_at: reserva.expires_at
    });
}

async function abrirAvaliacoes(quadraId) {
    const quadra = quadrasCache.find((item) => Number(item.id) === Number(quadraId))
        || adminQuadrasCache.find((item) => Number(item.id) === Number(quadraId));
    $('avaliacaoQuadraId').value = quadraId;
    $('avaliacoesTitulo').textContent = quadra?.nome || 'Quadra';
    $('comentarioAvaliacao').value = '';
    document.querySelectorAll('input[name="notaAvaliacao"]').forEach((input) => {
        input.checked = false;
    });

    const container = $('listaAvaliacoes');
    container.innerHTML = '<div class="loading-line">Carregando avaliações...</div>';
    modal('avaliacoesModal')?.show();

    try {
        const avaliacoes = await apiFetch(`/quadras/${quadraId}/avaliacoes`);
        if (!avaliacoes.length) {
            container.innerHTML = `
                <div class="empty-state compact">
                    <i class="fa-regular fa-star"></i>
                    <strong>Ainda não há avaliações</strong>
                </div>
            `;
            return;
        }

        container.innerHTML = avaliacoes.map((item) => `
            <article class="review-item">
                <div>
                    <strong>${escapeHTML(item.cliente_nome || 'Cliente')}</strong>
                    <span>${formatDateTimeBR(item.created_at)}</span>
                </div>
                <div class="stars">${'★'.repeat(Number(item.nota))}${'☆'.repeat(5 - Number(item.nota))}</div>
                <p>${escapeHTML(item.comentario || 'Sem comentário.')}</p>
            </article>
        `).join('');
    } catch (err) {
        container.innerHTML = `<div class="empty-state compact">${escapeHTML(err.message)}</div>`;
    }
}

async function handleAvaliacao(event) {
    event.preventDefault();
    if (!usuario) {
        showAlert('Entre na sua conta para avaliar.', 'warning');
        return;
    }

    const quadraId = $('avaliacaoQuadraId').value;
    const nota = document.querySelector('input[name="notaAvaliacao"]:checked')?.value;
    if (!nota) {
        showAlert('Escolha uma nota.', 'warning');
        return;
    }

    try {
        await apiFetch(`/quadras/${quadraId}/avaliacoes`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                nota: Number(nota),
                comentario: $('comentarioAvaliacao').value
            })
        });
        showAlert('Avaliação registrada.');
        abrirAvaliacoes(Number(quadraId));
        carregarQuadras();
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

function preencherSelectHorarios() {
    const select = $('bloqueioHorario');
    if (!select) return;
    const open = Number(appConfig.open_hour || 6);
    const close = Number(appConfig.close_hour || 23);
    select.innerHTML = '';
    for (let hour = open; hour < close; hour += 1) {
        const horario = `${String(hour).padStart(2, '0')}:00`;
        select.insertAdjacentHTML('beforeend', `<option value="${horario}">${horario}</option>`);
    }
}

function preencherSelectQuadrasBloqueio() {
    const select = $('bloqueioQuadra');
    if (!select) return;
    select.innerHTML = adminQuadrasCache.map((quadra) => `
        <option value="${quadra.id}">${escapeHTML(quadra.nome)}</option>
    `).join('');
}

async function cadastrarQuadra(event) {
    event.preventDefault();
    const formData = new FormData();
    formData.append('nome', $('nomeQuadra').value);
    formData.append('tipo', $('tipoQuadra').value);
    formData.append('preco_hora', $('precoQuadra').value);
    formData.append('status', $('statusQuadra').value);
    formData.append('descricao', $('descricaoQuadra').value);
    if ($('imagemQuadra').files[0]) formData.append('quadra_imagem', $('imagemQuadra').files[0]);

    try {
        await apiFetch('/admin/quadras', {
            method: 'POST',
            headers: authHeaders(),
            body: formData
        });
        event.target.reset();
        showAlert('Quadra cadastrada.');
        await carregarAdminQuadras();
        renderAdminStats();
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

async function carregarAdminQuadras() {
    const container = $('listaAdminQuadras');
    if (container) container.innerHTML = '<div class="loading-line">Carregando quadras...</div>';

    adminQuadrasCache = await apiFetch('/admin/quadras', { headers: authHeaders() });
    preencherSelectQuadrasBloqueio();

    if (!container) return;
    container.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Quadra</th>
                    <th>Tipo</th>
                    <th>Preço</th>
                    <th>Status</th>
                    <th>Avaliação</th>
                    <th>Ações</th>
                </tr>
            </thead>
            <tbody>
                ${adminQuadrasCache.map((quadra) => `
                    <tr>
                        <td>
                            <div class="table-court">
                                ${imageHTML(quadra, 'table-image')}
                                <div>
                                    <strong>${escapeHTML(quadra.nome)}</strong>
                                    <small>${escapeHTML(quadra.descricao || 'Sem descrição')}</small>
                                </div>
                            </div>
                        </td>
                        <td>${escapeHTML(quadra.tipo)}</td>
                        <td>${formatCurrency(quadra.preco_hora)}</td>
                        <td><span class="status-chip status-${escapeHTML(quadra.status)}">${statusLabel(quadra.status)}</span></td>
                        <td>${Number(quadra.total_avaliacoes) ? `${Number(quadra.media_avaliacao).toFixed(1)} (${quadra.total_avaliacoes})` : '-'}</td>
                        <td>
                            <div class="table-actions">
                                <button class="icon-btn" type="button" title="Editar" onclick="abrirEditarQuadra(${quadra.id})">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                                <button class="icon-btn danger" type="button" title="Remover" onclick="removerQuadra(${quadra.id})">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function abrirEditarQuadra(id) {
    const quadra = adminQuadrasCache.find((item) => Number(item.id) === Number(id));
    if (!quadra) return;

    $('editQuadraId').value = quadra.id;
    $('editNomeQuadra').value = quadra.nome;
    $('editTipoQuadra').value = quadra.tipo;
    $('editPrecoQuadra').value = quadra.preco_hora;
    $('editStatusQuadra').value = quadra.status;
    $('editDescricaoQuadra').value = quadra.descricao || '';
    $('editImagemQuadra').value = '';
    modal('editarQuadraModal')?.show();
}

async function salvarEdicaoQuadra(event) {
    event.preventDefault();
    const id = $('editQuadraId').value;
    const formData = new FormData();
    formData.append('nome', $('editNomeQuadra').value);
    formData.append('tipo', $('editTipoQuadra').value);
    formData.append('preco_hora', $('editPrecoQuadra').value);
    formData.append('status', $('editStatusQuadra').value);
    formData.append('descricao', $('editDescricaoQuadra').value);
    if ($('editImagemQuadra').files[0]) formData.append('quadra_imagem', $('editImagemQuadra').files[0]);

    try {
        await apiFetch(`/admin/quadras/${id}`, {
            method: 'PUT',
            headers: authHeaders(),
            body: formData
        });
        modal('editarQuadraModal')?.hide();
        showAlert('Quadra atualizada.');
        await carregarAdminQuadras();
        renderAdminStats();
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

async function removerQuadra(id) {
    if (!confirm('Remover esta quadra e seus agendamentos?')) return;

    try {
        await apiFetch(`/admin/quadras/${id}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        showAlert('Quadra removida.');
        await atualizarAdmin();
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

async function carregarAdminAgendamentos() {
    const container = $('listaAgendamentos');
    if (container) container.innerHTML = '<div class="loading-line">Carregando agendamentos...</div>';

    adminAgendamentosCache = await apiFetch('/admin/agendamentos', { headers: authHeaders() });
    if (!container) return;

    container.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Cliente</th>
                    <th>Quadra</th>
                    <th>Reserva</th>
                    <th>Valores</th>
                    <th>Status</th>
                    <th>Comprovante</th>
                    <th>Ações</th>
                </tr>
            </thead>
            <tbody>
                ${adminAgendamentosCache.map((item) => `
                    <tr>
                        <td>
                            <strong>${escapeHTML(item.cliente_nome || 'Cliente')}</strong>
                            <small>${escapeHTML(item.cliente_email || '')}</small>
                        </td>
                        <td>${escapeHTML(item.quadra_nome)}</td>
                        <td>${formatDateBR(item.data)}<br><small>${escapeHTML(item.horario)} às ${escapeHTML(item.horario_fim || '')}</small></td>
                        <td>Total: ${formatCurrency(item.valor_total)}<br><small>Sinal: ${formatCurrency(item.valor_sinal)}</small></td>
                        <td><span class="status-chip status-${escapeHTML(item.status)}">${statusLabel(item.status)}</span></td>
                        <td>
                            ${item.comprovante ? `
                                <a href="${escapeHTML(item.comprovante)}" target="_blank" class="btn btn-soft btn-sm">
                                    <i class="fa-solid fa-eye"></i>
                                    Ver
                                </a>
                            ` : '<span class="muted-text">Pendente</span>'}
                        </td>
                        <td>
                            <div class="table-actions">
                                ${item.status === 'pago' ? `
                                    <button class="icon-btn success" type="button" title="Confirmar" onclick="alterarStatusAgendamento(${item.id}, 'confirmado')">
                                        <i class="fa-solid fa-check"></i>
                                    </button>
                                ` : ''}
                                ${['pendente', 'pago', 'confirmado'].includes(item.status) ? `
                                    <button class="icon-btn danger" type="button" title="Cancelar" onclick="alterarStatusAgendamento(${item.id}, 'cancelado')">
                                        <i class="fa-solid fa-ban"></i>
                                    </button>
                                ` : ''}
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

async function alterarStatusAgendamento(id, status) {
    const texto = status === 'confirmado' ? 'confirmar este agendamento?' : 'cancelar este agendamento?';
    if (!confirm(`Deseja ${texto}`)) return;

    try {
        await apiFetch(`/admin/agendamentos/${id}/status`, {
            method: 'PUT',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ status })
        });
        showAlert(status === 'confirmado' ? 'Agendamento confirmado.' : 'Agendamento cancelado.');
        await carregarAdminAgendamentos();
        renderAdminStats();
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

async function carregarAdminAvaliacoes() {
    const container = $('listaAdminAvaliacoes');
    if (container) container.innerHTML = '<div class="loading-line">Carregando avaliacoes...</div>';

    adminAvaliacoesCache = await apiFetch('/admin/avaliacoes', { headers: authHeaders() });
    if (!container) return;

    if (!adminAvaliacoesCache.length) {
        container.innerHTML = `
            <div class="empty-state compact">
                <i class="fa-regular fa-star"></i>
                <strong>Nenhuma avaliacao cadastrada</strong>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Cliente</th>
                    <th>Quadra</th>
                    <th>Nota</th>
                    <th>Comentario</th>
                    <th>Data</th>
                    <th>Acoes</th>
                </tr>
            </thead>
            <tbody>
                ${adminAvaliacoesCache.map((item) => `
                    <tr>
                        <td>
                            <strong>${escapeHTML(item.cliente_nome || 'Cliente')}</strong>
                            <small>${escapeHTML(item.cliente_email || '')}</small>
                        </td>
                        <td>${escapeHTML(item.quadra_nome || '-')}</td>
                        <td>
                            <span class="stars">
                                ${Array.from({ length: Number(item.nota) }, () => '<i class="fa-solid fa-star"></i>').join('')}
                            </span>
                        </td>
                        <td>${escapeHTML(item.comentario || 'Sem comentario.')}</td>
                        <td>${formatDateTimeBR(item.created_at)}</td>
                        <td>
                            <button class="icon-btn danger" type="button" title="Remover" onclick="removerAvaliacao(${item.id})">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

async function removerAvaliacao(id) {
    if (!confirm('Remover esta avaliacao?')) return;

    try {
        await apiFetch(`/admin/avaliacoes/${id}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        showAlert('Avaliacao removida.');
        await carregarAdminAvaliacoes();
        await carregarAdminQuadras();
        renderAdminStats();
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

async function cadastrarBloqueio(event) {
    event.preventDefault();
    const dados = {
        quadra_id: Number($('bloqueioQuadra').value),
        data: $('bloqueioData').value,
        horario: $('bloqueioHorario').value,
        duracao_horas: Number($('bloqueioDuracao').value),
        motivo: $('bloqueioMotivo').value
    };

    try {
        await apiFetch('/admin/bloqueios', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(dados)
        });
        event.target.reset();
        $('bloqueioData').value = todayISO();
        showAlert('Horário fechado.');
        await carregarBloqueios();
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

async function carregarBloqueios() {
    const container = $('listaBloqueios');
    if (container) container.innerHTML = '<div class="loading-line">Carregando bloqueios...</div>';

    adminBloqueiosCache = await apiFetch('/admin/bloqueios', { headers: authHeaders() });
    if (!container) return;

    if (!adminBloqueiosCache.length) {
        container.innerHTML = `
            <div class="empty-state compact">
                <i class="fa-regular fa-clock"></i>
                <strong>Nenhum horário fechado</strong>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Quadra</th>
                    <th>Data</th>
                    <th>Horário</th>
                    <th>Motivo</th>
                    <th>Ações</th>
                </tr>
            </thead>
            <tbody>
                ${adminBloqueiosCache.map((item) => `
                    <tr>
                        <td>${escapeHTML(item.quadra_nome)}</td>
                        <td>${formatDateBR(item.data)}</td>
                        <td>${escapeHTML(item.horario)} às ${escapeHTML(item.horario_fim || '')}</td>
                        <td>${escapeHTML(item.motivo || 'Horário fechado')}</td>
                        <td>
                            <button class="icon-btn danger" type="button" title="Remover" onclick="removerBloqueio(${item.id})">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

async function removerBloqueio(id) {
    if (!confirm('Remover este bloqueio?')) return;

    try {
        await apiFetch(`/admin/bloqueios/${id}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        showAlert('Bloqueio removido.');
        await carregarBloqueios();
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

function renderAdminStats() {
    const container = $('adminStats');
    if (!container) return;

    const pendentes = adminAgendamentosCache.filter((item) => item.status === 'pendente').length;
    const pagos = adminAgendamentosCache.filter((item) => item.status === 'pago').length;
    const confirmados = adminAgendamentosCache.filter((item) => item.status === 'confirmado').length;
    const receitaSinal = adminAgendamentosCache
        .filter((item) => ['pago', 'confirmado'].includes(item.status))
        .reduce((sum, item) => sum + Number(item.valor_sinal || 0), 0);

    container.innerHTML = `
        <article class="metric-card">
            <span>Quadras</span>
            <strong>${adminQuadrasCache.length}</strong>
        </article>
        <article class="metric-card">
            <span>Comprovantes</span>
            <strong>${pagos}</strong>
        </article>
        <article class="metric-card">
            <span>Pendentes</span>
            <strong>${pendentes}</strong>
        </article>
        <article class="metric-card">
            <span>Confirmados</span>
            <strong>${confirmados}</strong>
        </article>
        <article class="metric-card">
            <span>Sinais recebidos</span>
            <strong>${formatCurrency(receitaSinal)}</strong>
        </article>
    `;
}

async function atualizarAdmin() {
    try {
        await Promise.all([
            carregarAdminQuadras(),
            carregarAdminAgendamentos(),
            carregarAdminAvaliacoes(),
            carregarBloqueios()
        ]);
        renderAdminStats();
    } catch (err) {
        showAlert(err.message, 'danger');
    }
}

function configurarNavegacaoAdmin() {
    document.querySelectorAll('.admin-nav-link').forEach((button) => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.admin-nav-link').forEach((item) => item.classList.remove('active'));
            button.classList.add('active');

            document.querySelectorAll('.admin-section').forEach((section) => section.classList.add('d-none'));
            $(`sec${button.dataset.section.charAt(0).toUpperCase()}${button.dataset.section.slice(1)}`)?.classList.remove('d-none');
        });
    });
}

async function iniciarAdmin() {
    if (!token || !usuario) {
        window.location.href = '/';
        return;
    }

    if (usuario.tipo !== 'admin') {
        showAlert('Acesso restrito ao administrador.', 'danger');
        window.location.href = '/';
        return;
    }

    if ($('adminNome')) $('adminNome').textContent = usuario.nome;
    if ($('bloqueioData')) {
        $('bloqueioData').min = todayISO();
        $('bloqueioData').value = todayISO();
    }
    preencherSelectHorarios();
    configurarNavegacaoAdmin();
    await atualizarAdmin();
}

function configurarEventos() {
    $('formCadastro')?.addEventListener('submit', handleCadastro);
    $('formLogin')?.addEventListener('submit', handleLogin);
    $('formAvaliacao')?.addEventListener('submit', handleAvaliacao);
    $('formNovaQuadra')?.addEventListener('submit', cadastrarQuadra);
    $('formEditarQuadra')?.addEventListener('submit', salvarEdicaoQuadra);
    $('formBloqueio')?.addEventListener('submit', cadastrarBloqueio);

    $('cadastroCelular')?.addEventListener('input', (event) => aplicarMascaraCelular(event.target));
    $('filtroBusca')?.addEventListener('input', renderQuadras);
    $('filtroStatus')?.addEventListener('change', renderQuadras);
    $('dataAgendamento')?.addEventListener('change', carregarHorariosDisponiveis);
    document.querySelectorAll('input[name="duracaoAgendamento"]').forEach((input) => {
        input.addEventListener('change', carregarHorariosDisponiveis);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    configurarEventos();
    await carregarConfig();
    atualizarNavbar();
    atualizarStatusUsuario();
    preencherSelectHorarios();

    if (isAdminPage()) {
        iniciarAdmin();
    } else {
        carregarQuadras();
    }
});
