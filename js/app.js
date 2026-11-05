/* MR Engenharia - Controle de Obras
 * Etapa 2: login, tela inicial e cadastros (obras, fornecedores, equipamentos,
 * mao de obra e usuarios), com fila para enviar depois quando estiver sem internet.
 */
'use strict';

const VERSAO_APP = '2.0.0';
const CHAVES = { sessao: 'mr_sessao', dados: 'mr_dados', fila: 'mr_fila', falhas: 'mr_falhas' };

// ---------------------------------------------------------------------------
// ESTADO E ARMAZENAMENTO LOCAL
// ---------------------------------------------------------------------------

const estado = {
  sessao: lerLocal(CHAVES.sessao),
  dados: lerLocal(CHAVES.dados) || dadosVazios(),
  fila: lerLocal(CHAVES.fila) || [],
  falhas: lerLocal(CHAVES.falhas) || [],
  online: navigator.onLine,
  sincronizando: false
};

function dadosVazios() {
  return { eu: null, obras: [], fornecedores: [], equipamentos: [], prestadores: [], usuarios: [], servidor_em: null };
}

function lerLocal(chave) {
  try { return JSON.parse(localStorage.getItem(chave)); } catch (e) { return null; }
}

function gravarLocal(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { console.warn('Falha ao gravar', chave, e); }
}

function salvarEstado() {
  gravarLocal(CHAVES.dados, estado.dados);
  gravarLocal(CHAVES.fila, estado.fila);
  gravarLocal(CHAVES.falhas, estado.falhas);
}

// ---------------------------------------------------------------------------
// COMUNICACAO COM O SERVIDOR
// ---------------------------------------------------------------------------

async function api(acao, dados) {
  const url = window.MR_CONFIG && window.MR_CONFIG.API_URL;
  if (!url) throw new Error('O endereço do servidor ainda não foi configurado.');
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ acao, token: estado.sessao && estado.sessao.token, dados: dados || {} })
    });
  } catch (e) {
    const err = new Error('Sem conexão com a internet.');
    err.offline = true;
    throw err;
  }
  let json;
  try {
    json = await resp.json();
  } catch (e) {
    const err = new Error('O servidor não respondeu direito. Tente de novo.');
    err.offline = true;
    throw err;
  }
  if (!json.ok) {
    const err = new Error(json.erro || 'Erro desconhecido.');
    err.codigo = json.codigo;
    if (json.codigo === 'SESSAO_INVALIDA' && acao !== 'login') sessaoExpirada();
    throw err;
  }
  return json.dados;
}

/** Envia o que ficou na fila e, se pedido, baixa os cadastros atualizados. */
async function sincronizar(opcoes) {
  const recarregar = !opcoes || opcoes.recarregar !== false;
  if (estado.sincronizando || !estado.sessao) return;
  estado.sincronizando = true;
  atualizarStatus();
  try {
    while (estado.fila.length) {
      const item = estado.fila[0];
      try {
        const res = await api(item.acao, item.dados);
        aplicarResposta(item, res);
      } catch (e) {
        if (e.offline || e.codigo === 'SESSAO_INVALIDA' || e.codigo === 'OCUPADO') throw e;
        item.erro = e.message;
        estado.falhas.push(item);
        removerPendenteLocal(item);
      }
      estado.fila.shift();
      salvarEstado();
    }
    if (recarregar) {
      const novos = await api('carregarDados');
      estado.dados = novos;
      estado.sessao.usuario = novos.eu;
      gravarLocal(CHAVES.sessao, estado.sessao);
      salvarEstado();
    }
    estado.online = true;
  } catch (e) {
    if (e.offline) estado.online = false;
  } finally {
    estado.sincronizando = false;
    atualizarStatus();
  }
}

function aplicarResposta(item, res) {
  if (item.acao === 'salvar' && res && res.id) {
    substituirLocal(TABELA_PARA_LISTA[item.dados.tabela], res);
  }
}

function removerPendenteLocal(item) {
  if (item.acao !== 'salvar') return;
  const lista = estado.dados[TABELA_PARA_LISTA[item.dados.tabela]];
  const i = lista.findIndex((r) => r.id === item.dados.registro.id && r._novoLocal);
  if (i >= 0) lista.splice(i, 1);
}

function substituirLocal(nomeLista, registro) {
  const lista = estado.dados[nomeLista];
  const i = lista.findIndex((r) => r.id === registro.id);
  if (i >= 0) lista[i] = registro; else lista.push(registro);
}

function sessaoExpirada() {
  estado.sessao = null;
  localStorage.removeItem(CHAVES.sessao);
  avisar('Sua sessão expirou. Entre novamente.');
  ir('#/login');
}

// ---------------------------------------------------------------------------
// DEFINICAO DOS CADASTROS
// ---------------------------------------------------------------------------

const OP = {
  situacaoObra: [['EM ANDAMENTO', 'Em andamento'], ['PARALISADA', 'Paralisada'], ['CONCLUIDA', 'Concluída']],
  tipoFornecedor: [['MATERIAL', 'Material'], ['LOCACAO', 'Locação de equipamentos'], ['MATERIAL E LOCACAO', 'Material e locação']],
  origem: [['PROPRIO', 'Próprio da empresa'], ['ALUGADO', 'Alugado']],
  periodoCobranca: [['DIA', 'Por dia'], ['SEMANA', 'Por semana'], ['QUINZENA', 'Por quinzena'], ['MES', 'Por mês']],
  periodoPagamento: [['SEMANAL', 'Semanal'], ['QUINZENAL', 'Quinzenal']],
  pixTipo: [['CPF', 'CPF'], ['CNPJ', 'CNPJ'], ['TELEFONE', 'Telefone'], ['EMAIL', 'E-mail'], ['ALEATORIA', 'Chave aleatória']],
  tipoConta: [['CORRENTE', 'Corrente'], ['POUPANCA', 'Poupança']],
  perfil: [['GESTOR', 'Gestor (acesso total)'], ['ENCARREGADO', 'Encarregado'], ['COLABORADOR', 'Colaborador']],
  localEquip: { DEPOSITO: 'No depósito', LOCADORA: 'Na locadora', OBRA: 'Em obra' }
};

const TIPOS_EQUIPAMENTO = ['Andaime', 'Betoneira', 'Compactador de solo', 'Cortadora de piso', 'Escora metálica',
  'Gerador', 'Guincho', 'Martelete', 'Furadeira', 'Serra circular', 'Vibrador de concreto',
  'Bomba d\'água', 'Placa vibratória', 'Container', 'Caçamba'];

const CADASTROS = {
  obras: {
    tabela: 'Obras', prefixo: 'OBR', titulo: 'Obras', singular: 'obra', icone: '🏗️',
    criam: ['GESTOR'], editam: ['GESTOR'], veem: ['GESTOR', 'ENCARREGADO', 'COLABORADOR'],
    tituloItem: (o) => o.nome,
    subItem: (o) => [o.municipio, nomeOpcao(OP.situacaoObra, o.situacao)].filter(Boolean).join(' · '),
    campos: [
      { c: 'nome', l: 'Nome da obra', obrig: true, ph: 'Escola Municipal Maria da Silva' },
      { c: 'orgao_contratante', l: 'Órgão contratante', ph: 'Prefeitura Municipal de …' },
      { c: 'numero_contrato', l: 'Nº do contrato', ph: '012/2026' },
      { c: 'municipio', l: 'Município', obrig: true, ph: 'João Pessoa - PB' },
      { c: 'endereco', l: 'Endereço', ph: 'Rua, número, bairro' },
      { c: 'situacao', l: 'Situação', tipo: 'select', opcoes: OP.situacaoObra, padrao: 'EM ANDAMENTO' }
    ]
  },
  fornecedores: {
    tabela: 'Fornecedores', prefixo: 'FOR', titulo: 'Fornecedores', singular: 'fornecedor', icone: '🏪',
    criam: ['GESTOR', 'ENCARREGADO', 'COLABORADOR'], editam: ['GESTOR'], veem: ['GESTOR', 'ENCARREGADO', 'COLABORADOR'],
    confirmacao: true,
    tituloItem: (f) => f.nome_fantasia || f.razao_social,
    subItem: (f) => [nomeOpcao(OP.tipoFornecedor, f.tipo), f.cnpj].filter(Boolean).join(' · '),
    campos: [
      { c: 'tipo', l: 'Tipo', tipo: 'select', opcoes: OP.tipoFornecedor, obrig: true },
      { c: 'razao_social', l: 'Razão social', obrig: true },
      { c: 'nome_fantasia', l: 'Nome fantasia' },
      { c: 'cnpj', l: 'CNPJ', mascara: 'cnpj', teclado: 'numeric', ph: '00.000.000/0000-00' },
      { c: 'inscricao_estadual', l: 'Inscrição estadual', teclado: 'numeric' },
      { c: 'telefone', l: 'Telefone', tipo: 'tel', mascara: 'telefone', ph: '(83) 99999-9999' },
      { c: 'email', l: 'E-mail', tipo: 'email' },
      { c: 'contato', l: 'Pessoa de contato' },
      { c: 'endereco', l: 'Endereço' },
      { c: 'municipio', l: 'Município' },
      { c: 'pix_chave', l: 'Chave Pix', soGestor: true },
      { c: 'banco', l: 'Banco', soGestor: true },
      { c: 'agencia', l: 'Agência', teclado: 'numeric', soGestor: true },
      { c: 'conta', l: 'Conta', soGestor: true },
      { c: 'observacao', l: 'Observação', tipo: 'textarea' }
    ]
  },
  equipamentos: {
    tabela: 'Equipamentos', prefixo: 'EQP', titulo: 'Equipamentos', singular: 'equipamento', icone: '🛠️',
    criam: ['GESTOR', 'ENCARREGADO', 'COLABORADOR'], editam: ['GESTOR'], veem: ['GESTOR', 'ENCARREGADO', 'COLABORADOR'],
    confirmacao: true,
    tituloItem: (e) => e.nome + (e.numero_serie ? ' · ' + e.numero_serie : ''),
    subItem: (e) => [e.origem === 'ALUGADO' ? 'Alugado' + (nomeFornecedor(e.fornecedor_id) ? ' (' + nomeFornecedor(e.fornecedor_id) + ')' : '') : 'Próprio',
      localEquipamento(e)].filter(Boolean).join(' · '),
    campos: [
      { c: 'nome', l: 'Nome do equipamento', obrig: true, ph: 'Betoneira 400 L' },
      { c: 'tipo', l: 'Tipo', obrig: true, sugestoes: TIPOS_EQUIPAMENTO, ph: 'Betoneira' },
      { c: 'numero_serie', l: 'Nº de série ou patrimônio' },
      { c: 'origem', l: 'Origem', tipo: 'select', opcoes: OP.origem, obrig: true },
      { c: 'fornecedor_id', l: 'Locadora', tipo: 'select', opcoesDinamicas: () => locadoras(), mostrarSe: { origem: 'ALUGADO' }, obrig: true,
        ajuda: 'Não achou a locadora? Cadastre em Fornecedores primeiro.' },
      { c: 'valor_locacao', l: 'Valor do aluguel (R$)', tipo: 'dinheiro', mostrarSe: { origem: 'ALUGADO' }, obrig: true },
      { c: 'periodo_cobranca', l: 'Cobrança', tipo: 'select', opcoes: OP.periodoCobranca, mostrarSe: { origem: 'ALUGADO' }, obrig: true },
      { c: 'observacao', l: 'Observação', tipo: 'textarea' }
    ]
  },
  prestadores: {
    tabela: 'Prestadores', prefixo: 'PRE', titulo: 'Mão de obra', singular: 'prestador', icone: '👷',
    criam: ['GESTOR'], editam: ['GESTOR'], veem: ['GESTOR', 'ENCARREGADO'],
    tituloItem: (p) => p.nome,
    subItem: (p) => [p.funcao, dinheiro(p.diaria) + '/dia', nomeOpcao(OP.periodoPagamento, p.periodo_pagamento)].filter(Boolean).join(' · '),
    inativo: (p) => !verdadeiro(p.ativo),
    campos: [
      { c: 'nome', l: 'Nome completo', obrig: true },
      { c: 'cpf', l: 'CPF', mascara: 'cpf', teclado: 'numeric', ph: '000.000.000-00' },
      { c: 'funcao', l: 'Função', sugestoes: ['Pedreiro', 'Servente', 'Mestre de obras', 'Carpinteiro', 'Armador', 'Eletricista', 'Encanador', 'Pintor', 'Soldador'] },
      { c: 'telefone', l: 'Telefone', tipo: 'tel', mascara: 'telefone', ph: '(83) 99999-9999' },
      { c: 'diaria', l: 'Valor da diária (R$)', tipo: 'dinheiro', obrig: true },
      { c: 'periodo_pagamento', l: 'Pagamento', tipo: 'select', opcoes: OP.periodoPagamento, obrig: true, padrao: 'SEMANAL' },
      { c: 'pix_tipo', l: 'Tipo da chave Pix', tipo: 'select', opcoes: OP.pixTipo, soGestor: true },
      { c: 'pix_chave', l: 'Chave Pix', soGestor: true },
      { c: 'banco', l: 'Banco', soGestor: true },
      { c: 'agencia', l: 'Agência', teclado: 'numeric', soGestor: true },
      { c: 'conta', l: 'Conta', soGestor: true },
      { c: 'tipo_conta', l: 'Tipo de conta', tipo: 'select', opcoes: OP.tipoConta, soGestor: true },
      { c: 'titular_conta', l: 'Titular da conta (se não for o próprio)', soGestor: true },
      { c: 'ativo', l: 'Ativo (aparece na folha)', tipo: 'checkbox', padrao: true }
    ]
  }
};

const TABELA_PARA_LISTA = { Obras: 'obras', Fornecedores: 'fornecedores', Equipamentos: 'equipamentos', Prestadores: 'prestadores' };

// ---------------------------------------------------------------------------
// FUNCOES DE APOIO
// ---------------------------------------------------------------------------

const $ = (sel, raiz) => (raiz || document).querySelector(sel);
const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function verdadeiro(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1; }

function nomeOpcao(lista, valor) {
  const op = lista.find((o) => o[0] === valor);
  return op ? op[1] : (valor || '');
}

function dinheiro(v) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || isNaN(n)) return '';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function paraNumero(v) {
  if (typeof v === 'number') return v;
  let s = String(v || '').replace(/[R$\s]/g, '');
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  return s === '' ? '' : Number(s);
}

function numeroParaCampo(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function perfil() { return estado.sessao && estado.sessao.usuario ? estado.sessao.usuario.perfil : null; }
function ehGestor() { return perfil() === 'GESTOR'; }

function nomeFornecedor(id) {
  const f = estado.dados.fornecedores.find((x) => x.id === id);
  return f ? (f.nome_fantasia || f.razao_social) : '';
}

function nomeObra(id) {
  const o = estado.dados.obras.find((x) => x.id === id);
  return o ? o.nome : '';
}

function localEquipamento(e) {
  if (e.local_atual === 'OBRA') return nomeObra(e.obra_atual_id) || 'Em obra';
  return OP.localEquip[e.local_atual] || '';
}

function locadoras() {
  return estado.dados.fornecedores
    .filter((f) => f.tipo === 'LOCACAO' || f.tipo === 'MATERIAL E LOCACAO')
    .map((f) => [f.id, f.nome_fantasia || f.razao_social])
    .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
}

function novoIdLocal(prefixo) {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let s = '';
  bytes.forEach((b) => { s += letras[b % letras.length]; });
  return prefixo + '-' + s;
}

function aplicarMascara(tipo, valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (tipo === 'cnpj') {
    return d.slice(0, 14).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
  }
  if (tipo === 'cpf') {
    return d.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  if (tipo === 'telefone') {
    const t = d.slice(0, 11);
    if (t.length <= 10) return t.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
    return t.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
  }
  return valor;
}

let timerAviso = null;
function avisar(msg) {
  const el = $('#aviso');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => { el.hidden = true; }, 3500);
}

function ir(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

// ---------------------------------------------------------------------------
// ROTAS
// ---------------------------------------------------------------------------

function render() {
  const partes = (location.hash || '#/inicio').replace(/^#\//, '').split('/');
  const rota = partes[0];

  if (!estado.sessao && rota !== 'login') return ir('#/login');
  if (estado.sessao && rota === 'login') return ir('#/inicio');

  window.scrollTo(0, 0);
  switch (rota) {
    case 'login': return telaLogin();
    case 'inicio': return telaInicio();
    case 'cadastros': return telaCadastros();
    case 'lista': return telaLista(partes[1]);
    case 'form': return telaFormulario(partes[1], partes[2]);
    case 'usuarios': return telaUsuarios();
    case 'usuario': return telaUsuario(partes[1]);
    case 'pendentes': return telaPendentes();
    case 'conta': return telaConta();
    default: return ir('#/inicio');
  }
}

function montar(html) {
  $('#app').innerHTML = html;
  atualizarStatus();
}

function barra(titulo, voltar) {
  return `
    <header class="barra">
      ${voltar ? `<button class="botao-icone" data-ir="${esc(voltar)}" aria-label="Voltar">←</button>` : ''}
      <h1>${esc(titulo)}</h1>
      <button class="status" id="status" data-ir="#/conta"></button>
    </header>`;
}

function atualizarStatus() {
  const el = $('#status');
  if (!el) return;
  const pend = estado.fila.length;
  let texto;
  if (estado.sincronizando) texto = 'Enviando…';
  else if (!estado.online) texto = 'Sem internet' + (pend ? ' · ' + pend + ' a enviar' : '');
  else if (pend) texto = pend + ' a enviar';
  else if (estado.falhas.length) texto = '⚠ ' + estado.falhas.length + ' com erro';
  else texto = '✓ Em dia';
  el.textContent = texto;
  el.classList.toggle('offline', !estado.online || estado.falhas.length > 0);
}

// Cliques em qualquer elemento com data-ir navegam para a rota
document.addEventListener('click', (ev) => {
  const alvo = ev.target.closest('[data-ir]');
  if (alvo) { ev.preventDefault(); ir(alvo.getAttribute('data-ir')); }
});

// ---------------------------------------------------------------------------
// TELA: LOGIN
// ---------------------------------------------------------------------------

function telaLogin() {
  const etapa = { email: '', nome: '', precisaCodigo: false };

  function passoEmail(erro) {
    montarLogin(`
      <h2>Bem-vindo</h2>
      <p class="sub">Controle de obras</p>
      ${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
      <form id="f">
        <div class="campo">
          <label for="email">E-mail</label>
          <input id="email" type="email" autocomplete="username" inputmode="email" required value="${esc(etapa.email)}" placeholder="seuemail@exemplo.com">
        </div>
        <button class="botao" type="submit">Continuar</button>
      </form>`);
    $('#email').focus();
    $('#f').onsubmit = async (ev) => {
      ev.preventDefault();
      etapa.email = $('#email').value.trim().toLowerCase();
      if (!etapa.email) return passoEmail('Digite o seu e-mail.');
      travarBotao(true);
      try {
        const r = await api('verificarEmail', { email: etapa.email });
        etapa.nome = r.nome;
        etapa.precisaCodigo = r.precisaCodigo;
        r.precisaCodigo ? passoCodigo() : passoSenha();
      } catch (e) {
        passoEmail(e.offline ? 'Para entrar pela primeira vez é preciso estar com internet.' : e.message);
      }
    };
  }

  function passoSenha(erro) {
    montarLogin(`
      <h2>Olá, ${esc(etapa.nome)}</h2>
      <p class="sub">${esc(etapa.email)}</p>
      ${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
      <form id="f">
        <input type="email" autocomplete="username" value="${esc(etapa.email)}" hidden>
        <div class="campo">
          <label for="senha">Senha</label>
          <input id="senha" type="password" autocomplete="current-password" required>
        </div>
        <button class="botao" type="submit">Entrar</button>
        <div class="botoes"><button type="button" class="link" id="trocar">Usar outro e-mail</button></div>
      </form>
      <p class="sub" style="margin-top:16px;font-size:13px">Esqueceu a senha? Peça a um gestor para gerar um novo código de acesso.</p>`);
    $('#senha').focus();
    $('#trocar').onclick = () => passoEmail();
    $('#f').onsubmit = async (ev) => {
      ev.preventDefault();
      travarBotao(true);
      try {
        const r = await api('login', { email: etapa.email, senha: $('#senha').value, dispositivo: navigator.userAgent });
        entrar(r);
      } catch (e) {
        passoSenha(e.offline ? 'Sem internet. Tente de novo quando tiver sinal.' : e.message);
      }
    };
  }

  function passoCodigo(erro) {
    montarLogin(`
      <h2>Primeiro acesso</h2>
      <p class="sub">Olá, ${esc(etapa.nome)}. Digite o código que o gestor te passou e crie a sua senha.</p>
      ${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
      <form id="f">
        <input type="email" autocomplete="username" value="${esc(etapa.email)}" hidden>
        <div class="campo">
          <label for="codigo">Código de primeiro acesso</label>
          <input id="codigo" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required placeholder="6 números">
        </div>
        <div class="campo">
          <label for="senha">Crie uma senha</label>
          <input id="senha" type="password" autocomplete="new-password" minlength="6" required>
          <div class="ajuda">Pelo menos 6 caracteres.</div>
        </div>
        <div class="campo">
          <label for="senha2">Repita a senha</label>
          <input id="senha2" type="password" autocomplete="new-password" minlength="6" required>
        </div>
        <button class="botao" type="submit">Criar senha e entrar</button>
        <div class="botoes"><button type="button" class="link" id="trocar">Usar outro e-mail</button></div>
      </form>`);
    $('#codigo').focus();
    $('#trocar').onclick = () => passoEmail();
    $('#f').onsubmit = async (ev) => {
      ev.preventDefault();
      const senha = $('#senha').value;
      if (senha !== $('#senha2').value) return passoCodigo('As duas senhas não são iguais.');
      if (senha.length < 6) return passoCodigo('A senha precisa ter pelo menos 6 caracteres.');
      travarBotao(true);
      try {
        const r = await api('primeiroAcesso', { email: etapa.email, codigo: $('#codigo').value.trim(), senha, dispositivo: navigator.userAgent });
        entrar(r);
      } catch (e) {
        passoCodigo(e.offline ? 'Sem internet. Tente de novo quando tiver sinal.' : e.message);
      }
    };
  }

  passoEmail();
}

function montarLogin(html) {
  $('#app').innerHTML = `<div class="login"><img class="logo" src="img/logo-mr.png" alt="MR Engenharia">${html}</div>`;
}

function travarBotao(travar) {
  const b = $('#app button[type=submit]');
  if (b) { b.disabled = travar; if (travar) b.textContent = 'Aguarde…'; }
}

async function entrar(r) {
  estado.sessao = { token: r.token, usuario: r.usuario };
  gravarLocal(CHAVES.sessao, estado.sessao);
  // Ao trocar de usuario, descarta dados guardados do anterior
  if (!estado.dados.eu || estado.dados.eu.id !== r.usuario.id) {
    estado.dados = dadosVazios();
    estado.fila = [];
    estado.falhas = [];
    salvarEstado();
  }
  $('#app').innerHTML = '<div class="carregando">Baixando cadastros…</div>';
  await sincronizar();
  ir('#/inicio');
}

// ---------------------------------------------------------------------------
// TELA: INICIO
// ---------------------------------------------------------------------------

function telaInicio() {
  const u = estado.sessao.usuario;
  const d = estado.dados;
  const pendentes = contarPendentesConfirmacao();
  const obrasAtivas = d.obras.filter((o) => o.situacao !== 'CONCLUIDA');

  montar(`
    ${barra('MR Obras')}
    <main class="conteudo">
      <div class="cartao boas-vindas">
        <img src="img/logo-mr.png" alt="">
        <div>
          <div class="nome">Olá, ${esc(String(u.nome).split(' ')[0])}</div>
          <div class="perfil">${esc(nomeOpcao(OP.perfil, u.perfil).replace(/ \(.*\)/, ''))}</div>
        </div>
      </div>

      ${ehGestor() && pendentes ? `
        <div class="secao-titulo">Atenção</div>
        <button class="atalho" style="width:100%;min-height:0" data-ir="#/pendentes">
          <span class="rotulo">⚠ ${pendentes} cadastro${pendentes > 1 ? 's' : ''} aguardando sua confirmação</span>
          <span class="detalhe">Feitos por colaboradores. Toque para revisar.</span>
        </button>` : ''}

      <div class="secao-titulo">Lançar</div>
      <div class="grade">
        <button class="atalho" disabled><span class="icone">🧾</span><span class="rotulo">Material</span><span class="detalhe">Disponível na etapa 3</span></button>
        <button class="atalho" disabled><span class="icone">🛠️</span><span class="rotulo">Equipamento</span><span class="detalhe">Disponível na etapa 3</span></button>
        ${perfil() !== 'COLABORADOR' ? '<button class="atalho" disabled><span class="icone">👷</span><span class="rotulo">Mão de obra</span><span class="detalhe">Disponível na etapa 4</span></button>' : ''}
      </div>

      <div class="secao-titulo">Obras em andamento</div>
      ${obrasAtivas.length ? `<ul class="lista">${obrasAtivas.map((o) => `
        <li><button class="item" data-ir="#/form/obras/${esc(o.id)}">
          <span class="textos"><span class="titulo">${esc(o.nome)}</span>
          <span class="sub">${esc([o.municipio, o.orgao_contratante].filter(Boolean).join(' · '))}</span></span>
          <span class="seta">›</span></button></li>`).join('')}</ul>`
        : `<div class="cartao vazio">${ehGestor() ? 'Nenhuma obra cadastrada ainda.<div class="botoes"><button class="botao" data-ir="#/form/obras">Cadastrar primeira obra</button></div>' : 'Nenhuma obra liberada para você. Fale com um gestor.'}</div>`}

      <div class="secao-titulo">Cadastros</div>
      <div class="grade">${menuCadastros()}</div>
    </main>`);
}

function menuCadastros() {
  const p = perfil();
  const itens = Object.keys(CADASTROS)
    .filter((k) => CADASTROS[k].veem.indexOf(p) >= 0)
    .map((k) => {
      const c = CADASTROS[k];
      const n = estado.dados[k].length;
      return `<button class="atalho" data-ir="#/lista/${k}"><span class="icone">${c.icone}</span>
        <span class="rotulo">${esc(c.titulo)}</span><span class="detalhe">${n} cadastrado${n === 1 ? '' : 's'}</span></button>`;
    });
  if (p === 'GESTOR') {
    const n = estado.dados.usuarios.filter((u) => verdadeiro(u.ativo)).length;
    itens.push(`<button class="atalho" data-ir="#/usuarios"><span class="icone">🔐</span>
      <span class="rotulo">Usuários do app</span><span class="detalhe">${n} ativo${n === 1 ? '' : 's'}</span></button>`);
  }
  return itens.join('');
}

function contarPendentesConfirmacao() {
  return estado.dados.fornecedores.filter((f) => f.status_cadastro === 'PENDENTE').length +
         estado.dados.equipamentos.filter((e) => e.status_cadastro === 'PENDENTE').length;
}

function telaCadastros() {
  montar(`${barra('Cadastros', '#/inicio')}<main class="conteudo"><div class="grade">${menuCadastros()}</div></main>`);
}

// ---------------------------------------------------------------------------
// TELA: LISTA DE UM CADASTRO
// ---------------------------------------------------------------------------

function telaLista(tipo) {
  const cfg = CADASTROS[tipo];
  if (!cfg || cfg.veem.indexOf(perfil()) < 0) return ir('#/inicio');
  const podeCriar = cfg.criam.indexOf(perfil()) >= 0;

  montar(`
    ${barra(cfg.titulo, '#/inicio')}
    <main class="conteudo">
      ${podeCriar ? `<div class="botoes" style="margin:0 0 14px"><button class="botao" data-ir="#/form/${tipo}">+ Cadastrar ${esc(cfg.singular)}</button></div>` : ''}
      <input type="search" class="busca" id="busca" placeholder="Buscar ${esc(cfg.titulo.toLowerCase())}…" aria-label="Buscar">
      <div id="resultado"></div>
    </main>`);

  const desenhar = () => {
    const termo = normalizarBusca($('#busca').value);
    const itens = estado.dados[tipo]
      .filter((r) => !termo || normalizarBusca(Object.values(r).join(' ')).indexOf(termo) >= 0)
      .sort((a, b) => String(cfg.tituloItem(a)).localeCompare(String(cfg.tituloItem(b)), 'pt-BR'));
    $('#resultado').innerHTML = itens.length
      ? `<ul class="lista">${itens.map((r) => `
          <li><button class="item" data-ir="#/form/${tipo}/${esc(r.id)}">
            <span class="textos"><span class="titulo">${esc(cfg.tituloItem(r))} ${etiquetas(cfg, r)}</span>
            <span class="sub">${esc(cfg.subItem(r))}</span></span><span class="seta">›</span></button></li>`).join('')}</ul>`
      : `<div class="cartao vazio">${termo ? 'Nada encontrado.' : 'Nenhum cadastro ainda.'}</div>`;
  };
  $('#busca').oninput = desenhar;
  desenhar();
}

function etiquetas(cfg, r) {
  let h = '';
  if (r._novoLocal || estado.fila.some((i) => i.dados && i.dados.registro && i.dados.registro.id === r.id)) {
    h += ' <span class="etiqueta envio">a enviar</span>';
  }
  if (cfg.confirmacao && r.status_cadastro === 'PENDENTE') h += ' <span class="etiqueta pendente">a confirmar</span>';
  if (cfg.inativo && cfg.inativo(r)) h += ' <span class="etiqueta inativo">inativo</span>';
  return h;
}

function normalizarBusca(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ---------------------------------------------------------------------------
// TELA: FORMULARIO DE UM CADASTRO
// ---------------------------------------------------------------------------

function telaFormulario(tipo, id) {
  const cfg = CADASTROS[tipo];
  if (!cfg || cfg.veem.indexOf(perfil()) < 0) return ir('#/inicio');

  const registro = id ? estado.dados[tipo].find((r) => r.id === id) : null;
  if (id && !registro) { avisar('Cadastro não encontrado.'); return ir('#/lista/' + tipo); }

  const pode = registro ? cfg.editam.indexOf(perfil()) >= 0 : cfg.criam.indexOf(perfil()) >= 0;
  const titulo = registro ? (pode ? 'Editar ' : '') + cfg.singular : 'Novo ' + cfg.singular;
  const campos = cfg.campos.filter((f) => !f.soGestor || ehGestor());

  montar(`
    ${barra(titulo.charAt(0).toUpperCase() + titulo.slice(1), '#/lista/' + tipo)}
    <main class="conteudo">
      <div id="erro"></div>
      ${registro && cfg.confirmacao && registro.status_cadastro === 'PENDENTE' ? '<div class="alerta-box">Cadastro feito por colaborador, aguardando confirmação de um gestor.</div>' : ''}
      ${!pode && registro ? '<div class="info">Somente gestores podem alterar este cadastro.</div>' : ''}
      ${!registro && cfg.confirmacao && !ehGestor() ? '<div class="info">Depois de salvo, um gestor vai conferir este cadastro.</div>' : ''}
      ${tipo === 'equipamentos' && registro ? `<div class="cartao padding" style="margin-bottom:14px">
          <div class="dados-linha"><span>Onde está agora</span><span>${esc(localEquipamento(registro) || '—')}</span></div></div>` : ''}
      <form id="f" novalidate>
        ${campos.map((f) => campoHtml(f, registro, !pode)).join('')}
        <div class="botoes">
          ${pode ? '<button class="botao" type="submit">Salvar</button>' : ''}
          ${registro && cfg.confirmacao && ehGestor() && registro.status_cadastro === 'PENDENTE' ? '<button class="botao secundario" type="button" id="confirmar">✓ Confirmar cadastro</button>' : ''}
          ${registro && ehGestor() ? '<button class="botao perigo" type="button" id="excluir">Excluir</button>' : ''}
        </div>
      </form>
    </main>`);

  ligarComportamentos($('#f'));

  if (pode) {
    $('#f').onsubmit = async (ev) => {
      ev.preventDefault();
      const dados = lerFormulario($('#f'), campos);
      const erro = validarFormulario(campos, dados);
      if (erro) return mostrarErro(erro);
      dados.id = registro ? registro.id : novoIdLocal(cfg.prefixo);
      await salvarCadastro(tipo, dados, !registro);
    };
  }

  const btConfirmar = $('#confirmar');
  if (btConfirmar) {
    btConfirmar.onclick = async () => {
      btConfirmar.disabled = true;
      try {
        const res = await api('confirmarCadastro', { tabela: cfg.tabela, id: registro.id });
        substituirLocal(tipo, res);
        salvarEstado();
        avisar('Cadastro confirmado.');
        ir('#/lista/' + tipo);
      } catch (e) {
        btConfirmar.disabled = false;
        mostrarErro(e.offline ? 'Para confirmar é preciso estar com internet.' : e.message);
      }
    };
  }

  const btExcluir = $('#excluir');
  if (btExcluir) {
    botaoComConfirmacao(btExcluir, 'Toque de novo para excluir', async () => {
      try {
        await api('excluir', { tabela: cfg.tabela, id: registro.id });
        estado.dados[tipo] = estado.dados[tipo].filter((r) => r.id !== registro.id);
        salvarEstado();
        avisar('Cadastro excluído.');
        ir('#/lista/' + tipo);
      } catch (e) {
        mostrarErro(e.offline ? 'Para excluir é preciso estar com internet.' : e.message);
      }
    });
  }
}

/** Salva no servidor; sem internet, guarda na fila e envia depois. */
async function salvarCadastro(tipo, dados, novo) {
  const cfg = CADASTROS[tipo];
  const botao = $('#f button[type=submit]');
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  const pedido = { acao: 'salvar', dados: { tabela: cfg.tabela, registro: dados } };

  try {
    if (!estado.online && estado.fila.length) throw Object.assign(new Error(), { offline: true });
    const res = await api(pedido.acao, pedido.dados);
    substituirLocal(tipo, res);
    estado.online = true;
    salvarEstado();
    avisar('Salvo.');
    ir('#/lista/' + tipo);
  } catch (e) {
    if (!e.offline) {
      botao.disabled = false;
      botao.textContent = 'Salvar';
      return mostrarErro(e.message);
    }
    estado.online = false;
    const local = Object.assign({}, estado.dados[tipo].find((r) => r.id === dados.id) || {}, dados);
    if (novo) {
      local._novoLocal = true;
      if (cfg.confirmacao) local.status_cadastro = ehGestor() ? 'CONFIRMADO' : 'PENDENTE';
      if (tipo === 'equipamentos') local.local_atual = dados.origem === 'ALUGADO' ? 'LOCADORA' : 'DEPOSITO';
    }
    substituirLocal(tipo, local);
    estado.fila.push(pedido);
    salvarEstado();
    avisar('Sem internet: salvo no celular. Será enviado quando tiver sinal.');
    ir('#/lista/' + tipo);
  }
}

function campoHtml(f, registro, somenteLeitura) {
  let valor = registro ? registro[f.c] : f.padrao;
  if (valor === undefined || valor === null) valor = '';
  const dis = somenteLeitura ? ' disabled' : '';
  const id = 'c_' + f.c;
  const mostrar = f.mostrarSe ? ` data-mostrar-se='${esc(JSON.stringify(f.mostrarSe))}'` : '';
  const obrig = f.obrig ? ' <span class="obrig">*</span>' : '';
  const ajuda = f.ajuda && !somenteLeitura ? `<div class="ajuda">${esc(f.ajuda)}</div>` : '';

  if (f.tipo === 'checkbox') {
    return `<div class="campo"${mostrar}><label class="checkbox"><input type="checkbox" id="${id}" name="${f.c}"${verdadeiro(valor) ? ' checked' : ''}${dis}> ${esc(f.l)}</label></div>`;
  }

  let entrada;
  if (f.tipo === 'select') {
    const opcoes = f.opcoesDinamicas ? f.opcoesDinamicas() : f.opcoes;
    entrada = `<select id="${id}" name="${f.c}"${dis}>
      <option value="">Selecione…</option>
      ${opcoes.map((o) => `<option value="${esc(o[0])}"${String(valor) === String(o[0]) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}
    </select>`;
  } else if (f.tipo === 'textarea') {
    entrada = `<textarea id="${id}" name="${f.c}"${dis}>${esc(valor)}</textarea>`;
  } else {
    const tipoInput = f.tipo === 'email' ? 'email' : f.tipo === 'tel' ? 'tel' : 'text';
    const teclado = f.tipo === 'dinheiro' ? 'decimal' : (f.teclado || (f.tipo === 'tel' ? 'tel' : ''));
    const v = f.tipo === 'dinheiro' ? numeroParaCampo(valor) : valor;
    const lista = f.sugestoes ? ` list="l_${f.c}"` : '';
    entrada = `<input type="${tipoInput}" id="${id}" name="${f.c}" value="${esc(v)}"${teclado ? ` inputmode="${teclado}"` : ''}
      ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}${f.mascara ? ` data-mascara="${f.mascara}"` : ''}${lista} autocomplete="off"${dis}>
      ${f.sugestoes ? `<datalist id="l_${f.c}">${sugestoesCampo(f).map((s) => `<option value="${esc(s)}">`).join('')}</datalist>` : ''}`;
  }
  return `<div class="campo"${mostrar}><label for="${id}">${esc(f.l)}${obrig}</label>${entrada}${ajuda}</div>`;
}

/** Junta as sugestoes fixas com o que ja foi digitado em outros cadastros. */
function sugestoesCampo(f) {
  const usados = [];
  Object.keys(CADASTROS).forEach((k) => {
    if (CADASTROS[k].campos.indexOf(f) >= 0) estado.dados[k].forEach((r) => { if (r[f.c]) usados.push(String(r[f.c])); });
  });
  return Array.from(new Set(f.sugestoes.concat(usados))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function ligarComportamentos(form) {
  $$('[data-mascara]', form).forEach((el) => {
    el.addEventListener('input', () => { el.value = aplicarMascara(el.getAttribute('data-mascara'), el.value); });
  });
  const atualizarVisiveis = () => {
    $$('[data-mostrar-se]', form).forEach((bloco) => {
      const regra = JSON.parse(bloco.getAttribute('data-mostrar-se'));
      const visivel = Object.keys(regra).every((c) => {
        const el = form.elements[c];
        return el && el.value === regra[c];
      });
      bloco.hidden = !visivel;
    });
  };
  form.addEventListener('change', atualizarVisiveis);
  atualizarVisiveis();
}

function lerFormulario(form, campos) {
  const dados = {};
  campos.forEach((f) => {
    const el = form.elements[f.c];
    if (!el) return;
    const bloco = el.closest('.campo');
    if (bloco && bloco.hidden) { dados[f.c] = ''; return; }
    if (f.tipo === 'checkbox') dados[f.c] = el.checked;
    else if (f.tipo === 'dinheiro') dados[f.c] = paraNumero(el.value);
    else dados[f.c] = el.value.trim();
  });
  return dados;
}

function validarFormulario(campos, dados) {
  for (const f of campos) {
    const el = $('#c_' + f.c);
    const visivel = el && !el.closest('.campo').hidden;
    if (!visivel) continue;
    if (f.obrig && (dados[f.c] === '' || dados[f.c] === undefined)) return 'Preencha: ' + f.l + '.';
    if (f.tipo === 'dinheiro' && dados[f.c] !== '' && (isNaN(dados[f.c]) || dados[f.c] < 0)) return 'Valor inválido em: ' + f.l + '.';
    if (f.tipo === 'email' && dados[f.c] && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dados[f.c])) return 'E-mail inválido.';
  }
  return null;
}

function mostrarErro(msg) {
  const el = $('#erro');
  if (el) { el.innerHTML = `<div class="erro">${esc(msg)}</div>`; window.scrollTo(0, 0); } else avisar(msg);
}

/** Botao que pede um segundo toque antes de executar (evita exclusao sem querer). */
function botaoComConfirmacao(botao, textoConfirmar, acao) {
  const original = botao.textContent;
  let armado = false;
  let timer = null;
  botao.onclick = async () => {
    if (!armado) {
      armado = true;
      botao.textContent = textoConfirmar;
      botao.classList.add('confirmar');
      timer = setTimeout(() => { armado = false; botao.textContent = original; botao.classList.remove('confirmar'); }, 4000);
      return;
    }
    clearTimeout(timer);
    botao.disabled = true;
    botao.textContent = 'Aguarde…';
    await acao();
    botao.disabled = false;
    botao.textContent = original;
    botao.classList.remove('confirmar');
    armado = false;
  };
}

// ---------------------------------------------------------------------------
// TELA: CADASTROS AGUARDANDO CONFIRMACAO (gestor)
// ---------------------------------------------------------------------------

function telaPendentes() {
  if (!ehGestor()) return ir('#/inicio');
  const itens = [];
  ['fornecedores', 'equipamentos'].forEach((k) => {
    estado.dados[k].filter((r) => r.status_cadastro === 'PENDENTE').forEach((r) => itens.push({ k, r }));
  });
  const autor = (id) => { const u = estado.dados.usuarios.find((x) => x.id === id); return u ? u.nome : ''; };
  montar(`
    ${barra('A confirmar', '#/inicio')}
    <main class="conteudo">
      ${itens.length ? `<ul class="lista">${itens.map(({ k, r }) => `
        <li><button class="item" data-ir="#/form/${k}/${esc(r.id)}">
          <span class="textos"><span class="titulo">${esc(CADASTROS[k].tituloItem(r))}</span>
          <span class="sub">${esc(CADASTROS[k].singular)} · por ${esc(autor(r.criado_por) || 'colaborador')}</span></span>
          <span class="seta">›</span></button></li>`).join('')}</ul>`
        : '<div class="cartao vazio">Nada aguardando confirmação.</div>'}
    </main>`);
}

// ---------------------------------------------------------------------------
// TELAS: USUARIOS DO APP (gestor)
// ---------------------------------------------------------------------------

function telaUsuarios() {
  if (!ehGestor()) return ir('#/inicio');
  const lista = estado.dados.usuarios.slice().sort((a, b) =>
    (verdadeiro(b.ativo) - verdadeiro(a.ativo)) || a.nome.localeCompare(b.nome, 'pt-BR'));
  montar(`
    ${barra('Usuários do app', '#/inicio')}
    <main class="conteudo">
      <div class="botoes" style="margin:0 0 14px"><button class="botao" data-ir="#/usuario">+ Cadastrar usuário</button></div>
      <ul class="lista">${lista.map((u) => `
        <li><button class="item" data-ir="#/usuario/${esc(u.id)}">
          <span class="textos"><span class="titulo">${esc(u.nome)}
            ${!verdadeiro(u.ativo) ? '<span class="etiqueta inativo">inativo</span>' : !u.tem_senha ? '<span class="etiqueta pendente">aguardando 1º acesso</span>' : ''}</span>
          <span class="sub">${esc(nomeOpcao(OP.perfil, u.perfil).replace(/ \(.*\)/, ''))} · ${esc(u.email)}</span></span>
          <span class="seta">›</span></button></li>`).join('')}</ul>
    </main>`);
}

function telaUsuario(id) {
  if (!ehGestor()) return ir('#/inicio');
  const u = id ? estado.dados.usuarios.find((x) => x.id === id) : null;
  if (id && !u) return ir('#/usuarios');
  const obrasSel = u && u.obras_ids !== 'TODAS' ? u.obras_ids : [];
  const souEu = u && u.id === estado.sessao.usuario.id;

  montar(`
    ${barra(u ? 'Editar usuário' : 'Novo usuário', '#/usuarios')}
    <main class="conteudo">
      <div id="erro"></div>
      ${u && !u.tem_senha && u.codigo_acesso ? blocoCodigo(u) : ''}
      <form id="f" novalidate>
        <div class="campo"><label for="nome">Nome <span class="obrig">*</span></label>
          <input type="text" id="nome" value="${esc(u ? u.nome : '')}" autocomplete="off"></div>
        <div class="campo"><label for="email">E-mail (usado para entrar) <span class="obrig">*</span></label>
          <input type="email" id="email" inputmode="email" value="${esc(u ? u.email : '')}" autocomplete="off"></div>
        <div class="campo"><label for="perfil">Perfil <span class="obrig">*</span></label>
          <select id="perfil"${souEu ? ' disabled' : ''}>${OP.perfil.map((p) => `<option value="${p[0]}"${(u ? u.perfil : 'COLABORADOR') === p[0] ? ' selected' : ''}>${esc(p[1])}</option>`).join('')}</select>
          <div class="ajuda" id="ajudaPerfil"></div></div>
        <div class="campo" id="blocoObras"><span class="rotulo-campo">Obras que pode ver e lançar</span>
          <div class="grupo-checks">${estado.dados.obras.length ? estado.dados.obras.map((o) => `
            <label class="checkbox"><input type="checkbox" name="obras" value="${esc(o.id)}"${obrasSel.indexOf(o.id) >= 0 ? ' checked' : ''}> ${esc(o.nome)}</label>`).join('')
            : '<div class="ajuda" style="padding:8px 0">Nenhuma obra cadastrada ainda.</div>'}</div></div>
        ${u && !souEu ? `<div class="campo"><label class="checkbox"><input type="checkbox" id="ativo"${verdadeiro(u.ativo) ? ' checked' : ''}> Usuário ativo (pode entrar no app)</label></div>` : ''}
        <div class="botoes">
          <button class="botao" type="submit">Salvar</button>
          ${u && !souEu ? '<button class="botao secundario" type="button" id="novoCodigo">Gerar novo código de acesso</button>' : ''}
        </div>
      </form>
    </main>`);

  const ajudas = {
    GESTOR: 'Vê e altera tudo, inclusive valores e dados bancários.',
    ENCARREGADO: 'Lança materiais, equipamentos e dias trabalhados das obras marcadas. Vê diárias, mas não vê dados bancários.',
    COLABORADOR: 'Lança materiais e equipamentos somente nas obras marcadas abaixo.'
  };
  const atualizarPerfil = () => {
    const p = $('#perfil').value;
    $('#ajudaPerfil').textContent = ajudas[p];
    $('#blocoObras').hidden = p === 'GESTOR';
  };
  $('#perfil').onchange = atualizarPerfil;
  atualizarPerfil();

  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const registro = {
      id: u ? u.id : undefined,
      nome: $('#nome').value.trim(),
      email: $('#email').value.trim().toLowerCase(),
      perfil: $('#perfil').value,
      obras_ids: $$('input[name=obras]:checked').map((c) => c.value),
      ativo: $('#ativo') ? $('#ativo').checked : true
    };
    if (!registro.nome) return mostrarErro('Preencha o nome.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(registro.email)) return mostrarErro('E-mail inválido.');
    if (registro.perfil !== 'GESTOR' && !registro.obras_ids.length) return mostrarErro('Marque pelo menos uma obra para este usuário.');
    const b = $('#f button[type=submit]');
    b.disabled = true; b.textContent = 'Salvando…';
    try {
      const res = await api('salvarUsuario', { registro });
      substituirLocal('usuarios', res);
      if (souEu) { estado.sessao.usuario.nome = res.nome; gravarLocal(CHAVES.sessao, estado.sessao); }
      salvarEstado();
      if (!u) { avisar('Usuário criado. Passe o código de acesso para a pessoa.'); ir('#/usuario/' + res.id); }
      else { avisar('Salvo.'); ir('#/usuarios'); }
    } catch (e) {
      b.disabled = false; b.textContent = 'Salvar';
      mostrarErro(e.offline ? 'Para cadastrar usuários é preciso estar com internet.' : e.message);
    }
  };

  const bt = $('#novoCodigo');
  if (bt) {
    botaoComConfirmacao(bt, 'Toque de novo: a senha atual deixa de valer', async () => {
      try {
        const r = await api('gerarNovoCodigo', { id: u.id });
        Object.assign(u, { codigo_acesso: r.codigo_acesso, tem_senha: false });
        salvarEstado();
        telaUsuario(u.id);
        avisar('Novo código gerado.');
      } catch (e) {
        mostrarErro(e.offline ? 'Para gerar código é preciso estar com internet.' : e.message);
      }
    });
  }
}

function blocoCodigo(u) {
  const link = location.href.split('#')[0];
  const texto = `Olá, ${String(u.nome).split(' ')[0]}! Seu acesso ao app MR Obras:\n` +
    `1. Abra: ${link}\n2. E-mail: ${u.email}\n3. Código de primeiro acesso: ${u.codigo_acesso}\nDepois é só criar a sua senha.`;
  return `
    <div class="cartao padding" style="margin-bottom:16px">
      <div style="font-weight:600">Código de primeiro acesso</div>
      <div class="codigo-acesso">${esc(u.codigo_acesso)}</div>
      <div class="ajuda" style="margin-bottom:12px">Passe este código para ${esc(String(u.nome).split(' ')[0])}. Ele serve só para criar a senha no primeiro login.</div>
      <a class="botao secundario" style="text-decoration:none" target="_blank" rel="noopener"
         href="https://wa.me/?text=${encodeURIComponent(texto)}">Enviar pelo WhatsApp</a>
    </div>`;
}

// ---------------------------------------------------------------------------
// TELA: MINHA CONTA E SINCRONIZACAO
// ---------------------------------------------------------------------------

function telaConta() {
  const u = estado.sessao.usuario;
  const ultima = estado.dados.servidor_em ? new Date(estado.dados.servidor_em).toLocaleString('pt-BR') : 'nunca';
  montar(`
    ${barra('Minha conta', '#/inicio')}
    <main class="conteudo">
      <div id="erro"></div>
      <div class="cartao padding">
        <div class="dados-linha"><span>Nome</span><span>${esc(u.nome)}</span></div>
        <div class="dados-linha"><span>E-mail</span><span>${esc(u.email)}</span></div>
        <div class="dados-linha"><span>Perfil</span><span>${esc(nomeOpcao(OP.perfil, u.perfil).replace(/ \(.*\)/, ''))}</span></div>
      </div>

      <div class="secao-titulo">Sincronização</div>
      <div class="cartao padding">
        <div class="dados-linha"><span>Internet</span><span>${estado.online ? 'Conectado' : 'Sem sinal'}</span></div>
        <div class="dados-linha"><span>Aguardando envio</span><span>${estado.fila.length}</span></div>
        <div class="dados-linha"><span>Última atualização</span><span>${esc(ultima)}</span></div>
        <div class="botoes"><button class="botao secundario" id="sync">Atualizar agora</button></div>
      </div>

      ${estado.falhas.length ? `
        <div class="secao-titulo">Não enviados (com erro)</div>
        <div class="cartao padding">
          ${estado.falhas.map((f, i) => `<div class="dados-linha"><span>${esc(descreverPedido(f))}</span><span style="color:#8E1515">${esc(f.erro)}</span></div>`).join('')}
          <div class="ajuda" style="margin-top:8px">Esses lançamentos foram recusados pelo servidor. Refaça o cadastro corrigindo o problema.</div>
          <div class="botoes"><button class="botao perigo" id="limparFalhas">Apagar esta lista</button></div>
        </div>` : ''}

      <div class="secao-titulo">Segurança</div>
      <div class="cartao padding">
        <form id="fs" novalidate>
          <div class="campo"><label for="sa">Senha atual</label><input type="password" id="sa" autocomplete="current-password"></div>
          <div class="campo"><label for="sn">Nova senha</label><input type="password" id="sn" autocomplete="new-password" minlength="6"></div>
          <button class="botao secundario" type="submit">Trocar senha</button>
        </form>
      </div>

      <div class="botoes"><button class="botao perigo" id="sair">Sair do app</button></div>
      <p class="ajuda" style="text-align:center;margin-top:16px">MR Obras · versão ${VERSAO_APP}</p>
    </main>`);

  $('#sync').onclick = async () => {
    await sincronizar();
    avisar(estado.online ? 'Atualizado.' : 'Sem internet no momento.');
    telaConta();
  };
  const lf = $('#limparFalhas');
  if (lf) botaoComConfirmacao(lf, 'Toque de novo para apagar', async () => { estado.falhas = []; salvarEstado(); telaConta(); });

  $('#fs').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api('trocarSenha', { senhaAtual: $('#sa').value, novaSenha: $('#sn').value });
      avisar('Senha trocada.');
      $('#fs').reset();
    } catch (e) {
      mostrarErro(e.offline ? 'Para trocar a senha é preciso estar com internet.' : e.message);
    }
  };

  botaoComConfirmacao($('#sair'), estado.fila.length ? 'Há itens não enviados! Toque de novo para sair mesmo assim' : 'Toque de novo para sair', async () => {
    try { await api('sair'); } catch (e) { /* sem internet: sai assim mesmo */ }
    estado.sessao = null;
    localStorage.removeItem(CHAVES.sessao);
    ir('#/login');
  });
}

function descreverPedido(p) {
  if (p.acao === 'salvar') {
    const k = TABELA_PARA_LISTA[p.dados.tabela];
    const r = p.dados.registro;
    return CADASTROS[k].singular + ': ' + (CADASTROS[k].tituloItem(r) || r.id);
  }
  return p.acao;
}

// ---------------------------------------------------------------------------
// INICIALIZACAO
// ---------------------------------------------------------------------------

window.addEventListener('hashchange', render);
window.addEventListener('online', () => { estado.online = true; sincronizar(); });
window.addEventListener('offline', () => { estado.online = false; atualizarStatus(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
setInterval(() => { if (estado.fila.length) sincronizar({ recarregar: false }); }, 60000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
}

render();
if (estado.sessao) sincronizar().then(() => { if (/^#\/(inicio)?$/.test(location.hash || '#/')) render(); });
