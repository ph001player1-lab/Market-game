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
var DEV_USERNAME = urlParams.get('u') || '';

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
function fmtSigned(m) {
  if (!m) return '—';
  var sign = m.thb < 0 ? '−' : '';
  return sign + Math.abs(m.thb).toLocaleString('ru-RU') + ' ฿';
}

// ------------------------------------------------------------ ИГРОК: UI

function loadPlayerDashboard() {
  apiGet('dashboard', { u: myUsername })
    .then(renderPlayerDashboard)
    .catch(function (err) { showError(err.message); });
}

var lastDashboard = null;

function renderPlayerDashboard(d) {
  if (!d.ok) { showError('Ошибка загрузки данных.'); return; }
  lastDashboard = d;

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

  // Персонал
  document.getElementById('staff-info').textContent =
    'Одна смена: ' + d.staff.shiftStepCapacity.toLocaleString('ru-RU') + ' клиентов ёмкости, ' +
    fmtMoney(d.staff.shiftStepCost) + '/мес';

  // Баннер банка
  var banner = document.getElementById('bank-banner');
  if (d.bankNotifications && d.bankNotifications.length) {
    banner.textContent = '🏦 ' + d.bankNotifications[d.bankNotifications.length - 1].message + ' (нажмите, чтобы скрыть)';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  renderMarketingBadges(d.marketing);
  renderBank(d.loan);
  renderLastResult(d.lastResult);
  renderDecisionForm(d);
}

function renderMarketingBadges(mk) {
  var seoBadge = document.getElementById('ch-seo-badge');
  if (mk.seoUnlocked) seoBadge.textContent = 'разблокировано, уровень ' + mk.seoLevel;
  else seoBadge.textContent = 'подряд ' + mk.seoStreak + ' из ' + mk.seoRampMonths + ' мес.';

  document.getElementById('ch-maps-badge').textContent = 'накоплено: ' + mk.mapsLevel;
  document.getElementById('ch-social-badge').textContent = 'накоплено: ' + mk.socialAdstock;
  document.getElementById('ch-outdoor-badge').textContent = mk.outdoorActive
    ? 'активна до месяца ' + mk.outdoorActiveUntil
    : 'не размещена';
  document.getElementById('ch-affiliate-badge').textContent = mk.affiliateActive ? 'активна' : 'не активна';
}

function renderBank(loan) {
  document.getElementById('bank-balance').textContent = fmtMoney(loan.balance);
  document.getElementById('bank-rate').textContent = Math.round(loan.rateAnnual * 100) + '% годовых';
  document.getElementById('bank-payment').textContent = loan.balance.thb > 0 ? fmtMoney(loan.estimatedNextPayment) : '—';
  document.getElementById('bank-term').textContent = loan.termLeft || '—';

  var bankActions = document.getElementById('bank-actions');
  bankActions.innerHTML = '';
  [1, 2, 3].forEach(function (tier) {
    if (tier <= loan.tier) {
      var b = document.createElement('button');
      b.className = 'btn-secondary';
      b.style.marginRight = '8px';
      b.style.marginBottom = '8px';
      b.textContent = 'Взять кредит (уровень ' + tier + ', до ' + fmtMoney(loan.limits['tier' + tier]) + ')';
      b.onclick = function () { requestLoan(tier); };
      bankActions.appendChild(b);
    }
  });
}

function renderLastResult(r) {
  var card = document.getElementById('last-result-card');
  if (!r) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  var total = Math.max(1, r.served + r.lost);
  document.getElementById('r-served-bar').style.width = (100 * r.served / total) + '%';
  document.getElementById('r-lost-bar').style.width = (100 * r.lost / total) + '%';
  document.getElementById('r-served').textContent = r.served.toLocaleString('ru-RU');
  document.getElementById('r-lost').textContent = r.lost.toLocaleString('ru-RU');

  document.getElementById('r-revenue').textContent = fmtMoney(r.revenue);
  document.getElementById('r-cogs').textContent = fmtSigned({ thb: -r.cogs.thb });
  document.getElementById('r-gross').textContent = fmtSigned(r.grossProfit);
  document.getElementById('r-rent').textContent = fmtSigned({ thb: -r.opex.rent.thb });
  document.getElementById('r-payroll').textContent = fmtSigned({ thb: -r.opex.payroll.thb });
  document.getElementById('r-shiftcost').textContent = fmtSigned({ thb: -r.opex.shiftCost.thb });
  document.getElementById('r-qupkeep').textContent = fmtSigned({ thb: -r.opex.qualityUpkeep.thb });
  document.getElementById('r-qinvest').textContent = fmtSigned({ thb: -r.opex.qualityInvest.thb });
  document.getElementById('r-marketing').textContent = fmtSigned({ thb: -r.opex.marketing.thb });
  document.getElementById('r-ebit').textContent = fmtSigned(r.ebit);
  document.getElementById('r-interest').textContent = fmtSigned({ thb: -r.interest.thb });
  document.getElementById('r-profit').textContent = fmtSigned(r.profit);
  document.getElementById('r-principal').textContent = fmtSigned({ thb: -r.principalPaid.thb });
  document.getElementById('r-cf').textContent = fmtSigned(r.cashFlow);
  document.getElementById('r-share').textContent = r.marketShare + '%';

  document.getElementById('r-mk-seo').textContent = fmtMoney(r.marketingByChannel.seo);
  document.getElementById('r-mk-promo').textContent = fmtMoney(r.marketingByChannel.promo);
  document.getElementById('r-mk-maps').textContent = fmtMoney(r.marketingByChannel.maps);
  document.getElementById('r-mk-social').textContent = fmtMoney(r.marketingByChannel.social);
  document.getElementById('r-mk-outdoor').textContent = fmtMoney(r.marketingByChannel.outdoor);
  document.getElementById('r-mk-affiliate').textContent = fmtMoney(r.marketingByChannel.affiliate);
}

function renderDecisionForm(d) {
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
    seoSpend: document.getElementById('f-seo').value,
    promoSpend: document.getElementById('f-promo').value,
    mapsSpend: document.getElementById('f-maps').value,
    socialSpend: document.getElementById('f-social').value,
    outdoorSpend: document.getElementById('f-outdoor').value,
    affiliateSpend: document.getElementById('f-affiliate').value,
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

function repayLoan() {
  var amount = document.getElementById('repay-amount').value;
  if (!amount || Number(amount) <= 0) { alert('Укажите сумму погашения.'); return; }
  apiPost('repayLoan', myUsername, { amount: amount })
    .then(function (res) {
      if (res.ok) {
        alert('Погашено: ' + fmtMoney(res.paid) + '. Остаток долга: ' + fmtMoney(res.remaining));
        document.getElementById('repay-amount').value = '';
        loadPlayerDashboard();
      } else {
        alert('Не удалось погасить: ' + res.error);
      }
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
