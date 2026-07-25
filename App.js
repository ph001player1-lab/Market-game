// ------------------------------------------------------------ НАСТРОЙКА API

// ⚠️ Единственное место, которое нужно менять при новом деплое Apps Script.
var EXEC_URL = 'https://script.google.com/macros/s/AKfycbzIZTMSiRaYuU4ZRJa2uHV9Tek-tiS71KiuGMS2K_5ttwSLDNpBgssu2CSctBoZ4t8z/exec';

function apiGet(action, params) {
  var url = EXEC_URL + '?action=' + encodeURIComponent(action);
  Object.keys(params || {}).forEach(function (k) {
    url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  });
  return fetch(url).then(function (r) { return r.json(); });
}

function apiPost(action, username, payload) {
  // Content-Type: text/plain — чтобы не вызвать CORS-preflight (Apps Script
  // не умеет отвечать на OPTIONS). Тело всё равно валидный JSON, парсим на сервере.
  return fetch(EXEC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, username: username, payload: payload || {} })
  }).then(function (r) { return r.json(); });
}

// ------------------------------------------------------------ ИНИЦИАЛИЗАЦИЯ

var tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }

var urlParams = new URLSearchParams(window.location.search);
var DEV_USERNAME = urlParams.get('u') || ''; // фолбэк для теста вне Telegram

var myUsername = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.username)
  ? tg.initDataUnsafe.user.username
  : DEV_USERNAME;

var myRole = null;
var pollTimer = null;

function showScreen(id) {
  ['loading', 'error-screen', 'player-app', 'admin-app'].forEach(function (s) {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function showError(text) {
  document.getElementById('error-text').textContent = text;
  showScreen('error-screen');
}

function boot() {
  if (!myUsername) {
    showError('Не удалось определить ваш Telegram-ник. Убедитесь, что в настройках Telegram задан @username.');
    return;
  }
  apiGet('identify', { u: myUsername })
    .then(function (id) {
      if (!id.ok) {
        var messages = {
          not_in_roster: 'Ваш ник (@' + myUsername + ') не найден в списке игроков. Обратитесь к ведущему.',
          no_username: 'Не удалось определить ваш Telegram-ник.'
        };
        showError(messages[id.error] || 'Ошибка входа.');
        return;
      }
      myRole = id.role;
      if (myRole === 'admin') { showScreen('admin-app'); loadAdminMonitor(); }
      else { showScreen('player-app'); loadPlayerDashboard(); }
      pollTimer = setInterval(myRole === 'admin' ? loadAdminMonitor : loadPlayerDashboard, 8000);
    })
    .catch(function (err) { showError('Ошибка соединения: ' + err.message); });
}

// ---------------------------------------------------------------- ФОРМАТ

function fmtMoney(m) {
  if (!m) return '—';
  return m.thb.toLocaleString('ru-RU') + ' ฿';
}
function fmtUsd(m) { return m ? '$' + m.usd.toLocaleString('en-US') : ''; }

// ------------------------------------------------------------ ИГРОК: UI

function loadPlayerDashboard() {
  apiGet('dashboard', { u: myUsername })
    .then(renderPlayerDashboard)
    .catch(function (err) { showError(err.message); });
}

function renderPlayerDashboard(d) {
  if (!d.ok) { showError('Ошибка загрузки данных.'); return; }

  document.getElementById('p-restaurant').textContent = d.player.restaurant;
  document.getElementById('p-round').textContent = 'Месяц ' + d.game.roundNumber +
    (d.game.roundStatus === 'open' ? ' · приём решений открыт' : ' · идёт обсуждение');

  var onboarding = document.getElementById('onboarding-card');
  var main = document.getElementById('player-main');
  if (d.needsOnboarding) {
    onboarding.classList.remove('hidden');
    main.classList.add('hidden');
    return;
  }
  onboarding.classList.add('hidden');
  main.classList.remove('hidden');

  document.getElementById('p-cash-thb').textContent = fmtMoney(d.player.cash);
  document.getElementById('p-cash-usd').textContent = fmtUsd(d.player.cash);
  document.getElementById('p-brand').textContent = d.player.brand;
  document.getElementById('p-rep').textContent = d.player.reputation;
  document.getElementById('p-quality').textContent = d.player.quality;
  document.getElementById('p-capacity').textContent = d.player.capacity.toLocaleString('ru-RU');
  document.getElementById('bank-tier').textContent = d.player.loanTier;

  // Баннер банка
  var banner = document.getElementById('bank-banner');
  if (d.bankNotifications && d.bankNotifications.length) {
    banner.textContent = '🏦 ' + d.bankNotifications[d.bankNotifications.length - 1].message + ' (нажмите, чтобы скрыть)';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  // Итоги прошлого месяца
  var card = document.getElementById('last-result-card');
  if (d.lastResult) {
    card.classList.remove('hidden');
    var r = d.lastResult;
    var total = Math.max(1, r.served + r.lost);
    document.getElementById('r-served-bar').style.width = (100 * r.served / total) + '%';
    document.getElementById('r-lost-bar').style.width = (100 * r.lost / total) + '%';
    document.getElementById('r-served').textContent = r.served.toLocaleString('ru-RU');
    document.getElementById('r-lost').textContent = r.lost.toLocaleString('ru-RU');
    document.getElementById('r-revenue').textContent = fmtMoney(r.revenue);
    document.getElementById('r-opex').textContent = fmtMoney(r.opex);
    document.getElementById('r-interest').textContent = fmtMoney(r.interest);
    document.getElementById('r-profit').textContent = fmtMoney(r.profit);
    document.getElementById('r-cf').textContent = fmtMoney(r.cashFlow);
    document.getElementById('r-share').textContent = r.marketShare + '%';
  } else {
    card.classList.add('hidden');
  }

  // Форма решения
  var form = document.getElementById('decision-form');
  var waiting = document.getElementById('decision-waiting');
  var closed = document.getElementById('decision-closed');
  form.classList.add('hidden'); waiting.classList.add('hidden'); closed.classList.add('hidden');

  if (d.game.roundStatus !== 'open') {
    closed.classList.remove('hidden');
  } else if (d.myDecisionSubmitted) {
    waiting.classList.remove('hidden');
  } else {
    form.classList.remove('hidden');
    document.getElementById('decision-title').textContent = 'Решение на месяц ' + d.game.roundNumber;
    if (!document.getElementById('f-price').value) document.getElementById('f-price').value = 300;
  }

  // Банк: кнопки
  var bankActions = document.getElementById('bank-actions');
  bankActions.innerHTML = '';
  [1, 2, 3].forEach(function (tier) {
    if (tier <= d.player.loanTier) {
      var b = document.createElement('button');
      b.className = 'btn-secondary';
      b.style.marginRight = '8px';
      b.textContent = 'Взять кредит (уровень ' + tier + ', до ' + fmtMoney(d.bankLimits['tier' + tier]) + ')';
      b.onclick = function () { requestLoan(tier); };
      bankActions.appendChild(b);
    }
  });
}

document.getElementById('onboarding-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var name = document.getElementById('ob-name').value;
  var restaurant = document.getElementById('ob-restaurant').value;
  apiPost('setProfile', myUsername, { displayName: name, restaurantName: restaurant })
    .then(function (res) {
      if (res.ok) loadPlayerDashboard();
      else alert('Заполните оба поля.');
    })
    .catch(function (err) { alert('Ошибка: ' + err.message); });
});

document.getElementById('decision-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var decision = {
    price: document.getElementById('f-price').value,
    adSpend: document.getElementById('f-ad').value,
    shiftsDelta: document.getElementById('f-shifts').value,
    qualityInvest: document.getElementById('f-quality').value
  };
  apiPost('submitDecision', myUsername, decision)
    .then(function (res) {
      if (res.ok) loadPlayerDashboard();
      else alert('Не удалось отправить решение: ' + res.error);
    })
    .catch(function (err) { alert('Ошибка: ' + err.message); });
});

function requestLoan(tier) {
  apiPost('requestLoan', myUsername, { tier: tier })
    .then(function (res) {
      if (res.ok) { alert('Получено: ' + fmtMoney(res.received)); loadPlayerDashboard(); }
      else alert('Кредит недоступен: ' + res.error);
    })
    .catch(function (err) { alert('Ошибка: ' + err.message); });
}

function dismissBankBanner() {
  document.getElementById('bank-banner').classList.add('hidden');
  apiPost('markBankRead', myUsername, {});
}

// ------------------------------------------------------------ АДМИН: UI

function loadAdminMonitor() {
  apiGet('monitor', { u: myUsername })
    .then(renderAdminMonitor)
    .catch(function (err) { showError(err.message); });
}

function renderAdminMonitor(d) {
  if (!d.ok) { showError('Ошибка загрузки данных.'); return; }
  document.getElementById('a-round').textContent = 'Месяц ' + d.round.number +
    ' · ' + (d.round.status === 'open' ? 'приём решений открыт' : 'закрыт');

  var body = document.getElementById('admin-monitor-body');
  body.innerHTML = '';
  d.players.forEach(function (p) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + p.restaurant + '</td>' +
      '<td>' + fmtMoney(p.cash) + '</td>' +
      '<td>' + p.brand + '</td>' +
      '<td>' + p.capacity.toLocaleString('ru-RU') + '</td>' +
      '<td>' + p.loanTier + '</td>' +
      '<td class="' + (p.submitted ? 'ok' : 'pending') + '">' + (p.submitted ? '✓' : '…') + '</td>' +
      '<td class="' + (p.joined ? 'ok' : 'pending') + '">' + (p.joined ? '✓' : '…') + '</td>';
    body.appendChild(tr);
  });
}

function adminOpenRound() {
  apiPost('adminOpenRound', myUsername, {})
    .then(function (res) {
      if (res.ok) loadAdminMonitor(); else alert('Не удалось открыть месяц: ' + res.error);
    })
    .catch(function (err) { alert('Ошибка: ' + err.message); });
}

function adminCalculateRound() {
  if (!confirm('Рассчитать месяц? Приём решений будет закрыт.')) return;
  apiPost('adminCalculateRound', myUsername, {})
    .then(function (res) {
      if (res.ok) { alert('Месяц рассчитан.'); loadAdminMonitor(); }
      else alert('Не удалось рассчитать: ' + res.error);
    })
    .catch(function (err) { alert('Ошибка: ' + err.message); });
}

boot();
