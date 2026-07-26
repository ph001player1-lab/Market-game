// "Захвати рынок или закрой бизнес" — MVP v0.14
// Кабинет игрока и администратора. Обращается к Code.gs через fetch()
// (только GET — см. пояснение внутри apiPost ниже).

// ------------------------------------------------------------ НАСТРОЙКА API

// ⚠️ Единственное место, которое нужно менять при новом деплое Apps Script.
var EXEC_URL = 'ВСТАВЬТЕ_СЮДА_ССЫЛКУ_НА_ВАШ_ДЕПЛОЙ/exec';

// Раньше при не-JSON ответе (HTML-страница ошибки от Google) сообщение
// об ошибке было криптичным ("Unexpected token '<'..."), не показывающим,
// что реально пришло. Теперь показываем начало настоящего ответа и код
// статуса — это единственный способ отличить "устаревший деплой",
// "требуется авторизация", "квота исчерпана" и т.п. друг от друга.
function parseJsonResponse(response) {
  return response.text().then(function (text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      var snippet = text.slice(0, 300).replace(/\s+/g, ' ').trim();
      throw new Error('сервер вернул не JSON (код ' + response.status + '): ' + snippet);
    }
  });
}

function apiGet(action, params) {
  if (!EXEC_URL || EXEC_URL.indexOf('ВСТАВЬТЕ') !== -1) {
    return Promise.reject(new Error('EXEC_URL не задан — вставьте ссылку на ваш деплой Apps Script в App.js.'));
  }
  var url = EXEC_URL + '?action=' + encodeURIComponent(action);
  Object.keys(params || {}).forEach(function (k) {
    url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  });
  return fetch(url).then(parseJsonResponse);
}

// Несмотря на название (оставлено для минимальных правок во всех вызовах
// ниже), это ТОЖЕ обычный GET, а не настоящий POST. Apps Script на POST
// к /exec отвечает 302-редиректом на googleusercontent.com, и этот
// редирект либо не принимает POST, либо fetch() при переходе по нему
// превращает его в GET и теряет тело запроса — задокументированная
// особенность самого Apps Script. GET проходит по тому же редиректу без
// проблем, поэтому и запись, и чтение идут через query-параметры.
function apiPost(action, username, payload) {
  if (!EXEC_URL || EXEC_URL.indexOf('ВСТАВЬТЕ') !== -1) {
    return Promise.reject(new Error('EXEC_URL не задан — вставьте ссылку на ваш деплой Apps Script в App.js.'));
  }
  var url = EXEC_URL + '?action=' + encodeURIComponent(action) + '&u=' + encodeURIComponent(username || '');
  Object.keys(payload || {}).forEach(function (k) {
    var v = payload[k];
    if (v && typeof v === 'object') v = JSON.stringify(v);
    url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v);
  });
  return fetch(url).then(parseJsonResponse);
}

// ------------------------------------------------------------ ИНДИКАЦИЯ ЗАГРУЗКИ
//
// Оборачивает любое действие, инициированное кнопкой: сразу блокирует её
// и меняет текст, чтобы пользователь понимал, что нажатие принято и не
// давил повторно, пока идёт обращение к серверу (обычно несколько секунд).
// Раньше кнопка разблокировалась сразу по ответу сервера — если ответ
// приходил за 1-2 секунды, а следующий опрос (каждые 8 сек) ещё не успел
// обновить экран, создавалось ощущение, что нажатие не засчиталось.
// Теперь блокировка держится минимум BUTTON_LOADING_MIN_MS независимо от
// скорости ответа — этого хватает на смену экрана после действия.
var BUTTON_LOADING_MIN_MS = 10000;

function withButtonLoading(btn, loadingText, fn) {
  if (!btn) return fn();
  var original = btn.textContent;
  btn.disabled = true;
  btn.classList.add('btn-loading');
  btn.textContent = loadingText || 'Обработка…';

  function restore() {
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    btn.textContent = original;
  }

  var minDelay = new Promise(function (resolve) { setTimeout(resolve, BUTTON_LOADING_MIN_MS); });
  var result = fn();
  var settled = (result && typeof result.then === 'function')
    ? result.then(function () {}, function () {}) // ждём завершения независимо от успеха/ошибки
    : Promise.resolve();

  Promise.all([settled, minDelay]).then(restore);
  return result;
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

// ------------------------------------------------------------ ТАЙМЕР МЕСЯЦА

var countdownInterval = null;
var countdownDeadlineMs = null;
var countdownFiredRefresh = false;

function startCountdown(deadlineIso, elementIds) {
  stopCountdown();
  if (!deadlineIso) {
    elementIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    return;
  }
  countdownDeadlineMs = new Date(deadlineIso).getTime();
  countdownFiredRefresh = false;
  tickCountdown(elementIds);
  countdownInterval = setInterval(function () { tickCountdown(elementIds); }, 1000);
}

function stopCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

function tickCountdown(elementIds) {
  var remainingSec = Math.max(0, Math.round((countdownDeadlineMs - Date.now()) / 1000));
  var mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  var ss = String(remainingSec % 60).padStart(2, '0');
  var text = mm + ':' + ss;
  var urgent = remainingSec <= 30;

  elementIds.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.toggle('timer-urgent', urgent);
  });

  // Как только время вышло — сразу подтягиваем свежее состояние, не дожидаясь
  // обычного 8-секундного опроса. Сам расчёт месяца сервер сделает при этом
  // же обращении (см. getCurrentRound_ в Code.gs), так что результат уже
  // будет готов к отображению.
  if (remainingSec <= 0 && !countdownFiredRefresh) {
    countdownFiredRefresh = true;
    stopCountdown();
    if (myRole === 'admin') loadAdminMonitor(); else loadPlayerDashboard();
  }
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

  var onboarding = document.getElementById('onboarding-card');
  var main = document.getElementById('player-main');
  var bankruptCard = document.getElementById('bankrupt-card');
  var employedCard = document.getElementById('employed-card');
  var leftCard = document.getElementById('left-card');

  document.getElementById('p-restaurant').textContent = d.player.restaurant;

  if (d.lifecycle === 'left') {
    [onboarding, main, bankruptCard, employedCard].forEach(function (el) { el.classList.add('hidden'); });
    leftCard.classList.remove('hidden');
    document.getElementById('p-round').textContent = '';
    document.getElementById('p-cash-thb').textContent = '';
    document.getElementById('p-cash-usd').textContent = '';
    stopCountdown();
    return;
  }
  if (d.lifecycle === 'bankrupt') {
    [onboarding, main, employedCard, leftCard].forEach(function (el) { el.classList.add('hidden'); });
    bankruptCard.classList.remove('hidden');
    document.getElementById('p-cash-thb').textContent = fmtMoney(d.player.cash);
    document.getElementById('p-cash-usd').textContent = '';
    document.getElementById('bankrupt-details').textContent =
      'В найме — зарплата ' + fmtMoney(d.employment.salary) + '/мес, для открытия нового дела нужно накопить ' +
      fmtMoney(d.employment.threshold) + '.';
    stopCountdown();
    return;
  }
  if (d.lifecycle === 'employed') {
    [onboarding, main, bankruptCard, leftCard].forEach(function (el) { el.classList.add('hidden'); });
    employedCard.classList.remove('hidden');
    document.getElementById('p-cash-thb').textContent = '';
    document.getElementById('p-cash-usd').textContent = '';
    document.getElementById('emp-savings').textContent = fmtMoney(d.employment.savings);
    document.getElementById('emp-salary').textContent = fmtMoney(d.employment.salary) + '/мес';
    document.getElementById('emp-threshold').textContent = fmtMoney(d.employment.threshold);
    document.getElementById('reopen-btn').classList.toggle('hidden', !d.employment.canReopen);
    stopCountdown();
    return;
  }
  [bankruptCard, employedCard, leftCard].forEach(function (el) { el.classList.add('hidden'); });

  document.getElementById('p-round').textContent = 'Месяц ' + d.game.roundNumber + ' из ' + d.game.totalRounds +
    (d.game.gameFinished ? ' · игра завершена' : (d.game.roundStatus === 'open' ? ' · приём решений открыт' : ' · идёт обсуждение'));

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
  renderTransferOptions(d.otherPlayers);
  startCountdown(d.game.roundStatus === 'open' ? d.game.deadline : null, ['p-timer']);
}

function renderTransferOptions(otherPlayers) {
  var select = document.getElementById('transfer-to');
  var current = select.value;
  select.innerHTML = '';
  (otherPlayers || []).forEach(function (p) {
    var opt = document.createElement('option');
    opt.value = p.username;
    opt.textContent = p.restaurant;
    select.appendChild(opt);
  });
  if (current && Array.from(select.options).some(function (o) { return o.value === current; })) {
    select.value = current;
  }
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
  document.getElementById('bank-available').textContent = fmtMoney(loan.available);

  document.getElementById('loan-request-block').classList.toggle('hidden', loan.tier < 1 || loan.available.thb <= 0);
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

  if (d.game.gameFinished) {
    closed.classList.remove('hidden');
    closed.querySelector('p').textContent = 'Игра завершена (' + d.game.totalRounds + ' мес.). Дождитесь новой игры от ведущего.';
  } else if (d.game.roundStatus !== 'open') {
    closed.classList.remove('hidden');
    closed.querySelector('p').textContent = 'Приём решений сейчас закрыт. Обсуждайте стратегию — форма откроется, когда ведущий начнёт месяц.';
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
  var btn = e.target.querySelector('button[type=submit]');
  var name = document.getElementById('ob-name').value;
  var restaurant = document.getElementById('ob-restaurant').value;
  withButtonLoading(btn, 'Сохраняем…', function () {
    return apiPost('setProfile', myUsername, { displayName: name, restaurantName: restaurant })
      .then(function (res) {
        if (res.ok) loadPlayerDashboard();
        else alert('Заполните оба поля.');
      })
      .catch(function (err) { alert('Ошибка: ' + err.message); });
  });
});

document.getElementById('decision-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var btn = e.target.querySelector('button[type=submit]');
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

  // Проверяем на клиенте ДО отправки — чтобы предупреждение появлялось
  // мгновенно, а не после круга до сервера и обратно. Сервер всё равно
  // проверяет то же самое сам — это только для скорости отклика.
  if (lastDashboard && lastDashboard.game) {
    var price = Number(decision.price) || 0;
    var floor = lastDashboard.game.priceFloor.thb;
    var ceiling = lastDashboard.game.priceCeiling.thb;
    if (price < floor) {
      alert('Цена не может быть ниже ' + floor.toLocaleString('ru-RU') + ' ฿. Поправьте и отправьте снова.');
      return;
    }
    if (price > ceiling) {
      alert('Цена не может быть выше ' + ceiling.toLocaleString('ru-RU') + ' ฿. Поправьте и отправьте снова.');
      return;
    }
    var totalSpend = ['seoSpend', 'promoSpend', 'mapsSpend', 'socialSpend', 'outdoorSpend', 'affiliateSpend', 'qualityInvest']
      .reduce(function (sum, key) { return sum + (Number(decision[key]) || 0); }, 0);
    var cash = lastDashboard.player.cash.thb;
    if (totalSpend > cash) {
      alert('Суммарные траты (' + totalSpend.toLocaleString('ru-RU') + ' ฿) больше, чем есть в кассе (' +
        cash.toLocaleString('ru-RU') + ' ฿). Уменьшите расходы и отправьте снова.');
      return;
    }
  }

  withButtonLoading(btn, 'Отправляем…', function () {
    return apiPost('submitDecision', myUsername, decision)
      .then(function (res) {
        if (res.ok) { loadPlayerDashboard(); return; }
        var messages = {
          price_too_low: 'Цена не может быть ниже ' + (res.min ? res.min.thb.toLocaleString('ru-RU') + ' ฿' : 'минимума') + '.',
          price_too_high: 'Цена не может быть выше ' + (res.max ? res.max.thb.toLocaleString('ru-RU') + ' ฿' : 'максимума') + '.',
          insufficient_cash: 'Суммарные траты (' + (res.totalSpend ? res.totalSpend.thb.toLocaleString('ru-RU') : '?') +
            ' ฿) больше, чем есть в кассе (' + (res.available ? res.available.thb.toLocaleString('ru-RU') : '?') + ' ฿).'
        };
        alert(messages[res.error] || ('Не удалось отправить решение: ' + res.error));
      })
      .catch(function (err) { alert('Ошибка: ' + err.message); });
  });
});

function requestLoan(btn) {
  var amount = document.getElementById('loan-amount').value;
  if (!amount || Number(amount) <= 0) { alert('Укажите сумму кредита.'); return; }
  withButtonLoading(btn, 'Оформляем…', function () {
    return apiPost('requestLoan', myUsername, { amount: amount })
      .then(function (res) {
        if (res.ok) {
          alert('Получено: ' + fmtMoney(res.received));
          document.getElementById('loan-amount').value = '';
          loadPlayerDashboard();
        } else {
          var messages = { no_tier: 'Кредит пока недоступен — банк ещё не открыл лимит.', invalid_amount: 'Некорректная сумма.', limit_reached: 'Лимит уже полностью выбран.' };
          alert(messages[res.error] || ('Кредит недоступен: ' + res.error));
        }
      })
      .catch(function (err) { alert('Ошибка: ' + err.message); });
  });
}

function repayLoan(btn) {
  var amount = document.getElementById('repay-amount').value;
  if (!amount || Number(amount) <= 0) { alert('Укажите сумму погашения.'); return; }
  withButtonLoading(btn, 'Погашаем…', function () {
    return apiPost('repayLoan', myUsername, { amount: amount })
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
  });
}

function transferMoney(btn) {
  var toUsername = document.getElementById('transfer-to').value;
  var amount = document.getElementById('transfer-amount').value;
  if (!toUsername) { alert('Выберите получателя.'); return; }
  if (!amount || Number(amount) <= 0) { alert('Укажите сумму перевода.'); return; }

  if (lastDashboard && lastDashboard.player && Number(amount) > lastDashboard.player.cash.thb) {
    alert('В кассе только ' + lastDashboard.player.cash.thb.toLocaleString('ru-RU') +
      ' ฿ — столько перевести нельзя. Уменьшите сумму и попробуйте снова.');
    return;
  }

  withButtonLoading(btn, 'Переводим…', function () {
    return apiPost('transferMoney', myUsername, { toUsername: toUsername, amount: amount })
      .then(function (res) {
        if (res.ok) {
          alert('Переведено ' + fmtMoney(res.sent) + ' → ' + res.toRestaurant);
          document.getElementById('transfer-amount').value = '';
          loadPlayerDashboard();
        } else {
          var messages = {
            invalid_amount: 'Укажите сумму больше нуля.',
            insufficient_cash: 'В кассе только ' + (res.available ? res.available.thb.toLocaleString('ru-RU') : '?') +
              ' ฿ — столько перевести нельзя.',
            recipient_not_found: 'Получатель не найден.', recipient_gone: 'Этот игрок уже вышел из игры.',
            self_transfer: 'Нельзя перевести самому себе.'
          };
          alert(messages[res.error] || ('Не удалось перевести: ' + res.error));
        }
      })
      .catch(function (err) { alert('Ошибка: ' + err.message); });
  });
}

function chooseBankruptcyPath(choice, btn) {
  withButtonLoading(btn, 'Обрабатываем…', function () {
    return apiPost('chooseBankruptcyPath', myUsername, { choice: choice })
      .then(function (res) {
        if (res.ok) loadPlayerDashboard();
        else alert('Не удалось выполнить: ' + res.error);
      })
      .catch(function (err) { alert('Ошибка: ' + err.message); });
  });
}

function reopenBusiness(btn) {
  withButtonLoading(btn, 'Открываем дело…', function () {
    return apiPost('reopenBusiness', myUsername, {})
      .then(function (res) {
        if (res.ok) { alert('Новое дело открыто! Стартовый капитал: ' + fmtMoney(res.cash)); loadPlayerDashboard(); }
        else alert('Не удалось открыть дело: ' + res.error);
      })
      .catch(function (err) { alert('Ошибка: ' + err.message); });
  });
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

var STATUS_LABELS = {
  active: 'активен', bankrupt: 'банкрот (выбирает)', employed: 'в найме', left: 'вышел из игры'
};

function renderAdminMonitor(d) {
  if (!d.ok) { showError('Ошибка загрузки данных.'); return; }
  document.getElementById('a-round').textContent = 'Месяц ' + d.round.number + ' из ' + d.round.totalRounds +
    (d.round.gameFinished ? ' · игра завершена' : ' · ' + (d.round.status === 'open' ? 'приём решений открыт' : 'закрыт'));

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
      '<td>' + (STATUS_LABELS[p.status] || p.status) + '</td>' +
      '<td class="' + (p.submitted ? 'ok' : 'pending') + '">' + (p.submitted ? '✓' : '…') + '</td>' +
      '<td class="' + (p.joined ? 'ok' : 'pending') + '">' + (p.joined ? '✓' : '…') + '</td>';
    body.appendChild(tr);
  });

  startCountdown(d.round.status === 'open' ? d.round.deadline : null, ['a-timer']);
}

function adminOpenRound(btn) {
  withButtonLoading(btn, 'Открываем…', function () {
    return apiPost('adminOpenRound', myUsername, {})
      .then(function (res) {
        if (res.ok) { loadAdminMonitor(); return; }
        var messages = {
          already_open: 'Месяц уже открыт.',
          game_finished: 'Игра уже завершена (достигнут лимит месяцев). Чтобы начать заново — «Опасная зона» ниже.'
        };
        alert(messages[res.error] || ('Не удалось открыть месяц: ' + res.error));
      })
      .catch(function (err) { alert('Ошибка: ' + err.message); });
  });
}

function adminCalculateRound(btn) {
  if (!confirm('Рассчитать месяц? Приём решений будет закрыт.')) return;
  withButtonLoading(btn, 'Считаем…', function () {
    return apiPost('adminCalculateRound', myUsername, {})
      .then(function (res) {
        if (res.ok) { alert('Месяц рассчитан.'); loadAdminMonitor(); }
        else alert('Не удалось рассчитать: ' + res.error);
      })
      .catch(function (err) { alert('Ошибка: ' + err.message); });
  });
}

// ------------------------------------------------------------ СБРОС ИГРЫ

function revealResetConfirm() {
  document.getElementById('reset-confirm-block').classList.remove('hidden');
  document.getElementById('reset-reveal-btn').classList.add('hidden');
}

function cancelResetConfirm() {
  document.getElementById('reset-confirm-block').classList.add('hidden');
  document.getElementById('reset-reveal-btn').classList.remove('hidden');
  document.getElementById('reset-confirm-input').value = '';
}

function confirmResetGame(btn) {
  var text = document.getElementById('reset-confirm-input').value;
  if (!text) { alert('Введите код игры (см. лист Config → GAME_CODE).'); return; }
  withButtonLoading(btn, 'Сбрасываем…', function () {
    return apiPost('adminResetGame', myUsername, { confirmText: text })
      .then(function (res) {
        if (res.ok) {
          alert('Игра сброшена. Можно начинать заново с месяца 1.');
          cancelResetConfirm();
          loadAdminMonitor();
        } else {
          var messages = { confirmation_mismatch: 'Код игры не совпадает — сброс отменён.' };
          alert(messages[res.error] || ('Не удалось сбросить: ' + res.error));
        }
      })
      .catch(function (err) { alert('Ошибка: ' + err.message); });
  });
}

boot();
