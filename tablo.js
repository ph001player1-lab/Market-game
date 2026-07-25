// ⚠️ Та же ссылка, что и в App.js. Меняется в двух местах при новом деплое.
var EXEC_URL = 'https://script.google.com/macros/s/AKfycbx1VrfU2veRgXEzZqL8FhQ_4E6jJ2XFbh90IqMav2aWA-JcovkBP6IVqAffcBs9pWmK/exec';

var METRIC_LABELS = {
  profit: 'Прибыль, ฿',
  cash: 'Капитал (касса), ฿',
  marketSharePct: 'Доля рынка, %',
  served: 'Обслужено клиентов',
  price: 'Цена, ฿',
  brand: 'Бренд',
  reputation: 'Репутация',
  quality: 'Качество',
  capacity: 'Ёмкость (пропускная способность)',
  marketingTotal: 'Расходы на рекламу, ฿',
  qualityInvest: 'Расходы на качество, ฿'
};

var PALETTE = [
  '#3ba55d', '#5b8def', '#e0a530', '#d9534f', '#9b59b6', '#1abc9c',
  '#e67e22', '#2ecc71', '#e74c3c', '#3498db', '#f1c40f', '#95a5a6'
];

var currentMetric = 'profit';
var chart = null;
var lastTimeline = null;
var tabloCountdownInterval = null;
var tabloDeadlineMs = null;

var DEFAULT_EMPTY_TEXT = 'Пока нет данных — табло обновится, как только будет рассчитан первый месяц.';

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

function apiGet(action) {
  if (!EXEC_URL || EXEC_URL.indexOf('ВСТАВЬТЕ') !== -1) {
    return Promise.reject(new Error('EXEC_URL не задан — вставьте ссылку на ваш деплой Apps Script в tablo.js.'));
  }
  return fetch(EXEC_URL + '?action=' + encodeURIComponent(action)).then(parseJsonResponse);
}

function showTabloMessage(text) {
  var empty = document.getElementById('tablo-empty');
  var canvas = document.getElementById('tablo-chart');
  empty.textContent = text;
  empty.classList.remove('hidden');
  canvas.classList.add('hidden');
}

function loadTimeline() {
  apiGet('timeline')
    .then(function (d) {
      if (!d.ok) {
        // Раньше эта ветка молча ничего не делала — из-за этого при ошибке
        // на сервере (например, если руками стёрли данные из Rounds) табло
        // показывало пустой холст без единого объяснения. Теперь видно, в чём дело.
        showTabloMessage('Ошибка на сервере: ' + (d.error || 'неизвестная ошибка') +
          '. Проверьте Config → ADMIN_USERNAME и структуру листов (запустите setupSheets() ещё раз).');
        return;
      }
      lastTimeline = d;
      document.getElementById('t-round').textContent = 'Месяц ' + d.roundNumber +
        (d.totalRounds ? ' из ' + d.totalRounds : '');
      startTabloCountdown(d.roundStatus === 'open' ? d.deadline : null);
      renderChart();
    })
    .catch(function (err) {
      showTabloMessage('Не удалось связаться с сервером: ' + err.message);
    });
}

function startTabloCountdown(deadlineIso) {
  if (tabloCountdownInterval) { clearInterval(tabloCountdownInterval); tabloCountdownInterval = null; }
  var el = document.getElementById('t-timer');
  if (!deadlineIso) { el.classList.add('hidden'); return; }

  tabloDeadlineMs = new Date(deadlineIso).getTime();
  tick();
  tabloCountdownInterval = setInterval(tick, 1000);

  function tick() {
    var remaining = Math.max(0, Math.round((tabloDeadlineMs - Date.now()) / 1000));
    var mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    var ss = String(remaining % 60).padStart(2, '0');
    el.textContent = mm + ':' + ss;
    el.classList.remove('hidden');
    el.classList.toggle('timer-urgent', remaining <= 30);
    if (remaining <= 0) { clearInterval(tabloCountdownInterval); tabloCountdownInterval = null; }
  }
}

function renderChart() {
  var empty = document.getElementById('tablo-empty');
  var canvas = document.getElementById('tablo-chart');
  var techPage = document.getElementById('tablo-techinfo');

  if (currentMetric === 'techinfo') {
    canvas.classList.add('hidden');
    renderTechInfoPage();
    return;
  }
  techPage.classList.add('hidden');

  if (!lastTimeline) return;

  if (typeof Chart === 'undefined') {
    // Отдельная, честная причина: библиотека графиков не загрузилась
    // (например, CDN недоступен или версия не найдена) — это НЕ ошибка
    // сервера и НЕ повод писать "не удалось связаться с сервером".
    showTabloMessage('Не загрузилась библиотека графиков (Chart.js). Проверьте интернет-соединение на этом экране и обновите страницу.');
    return;
  }

  var hasData = lastTimeline.players.some(function (p) { return p.series.length > 0; });
  if (!hasData) {
    empty.textContent = DEFAULT_EMPTY_TEXT;
    empty.classList.remove('hidden');
    canvas.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  canvas.classList.remove('hidden');

  var allRounds = new Set();
  lastTimeline.players.forEach(function (p) {
    p.series.forEach(function (pt) { allRounds.add(pt.round); });
  });
  var rounds = Array.from(allRounds).sort(function (a, b) { return a - b; });
  var labels = rounds.map(function (r) { return 'Мес. ' + r; });

  var datasets = lastTimeline.players.map(function (p, i) {
    var byRound = {};
    p.series.forEach(function (pt) { byRound[pt.round] = pt[currentMetric]; });
    var data = rounds.map(function (r) { return byRound.hasOwnProperty(r) ? byRound[r] : null; });
    var color = PALETTE[i % PALETTE.length];
    return {
      label: p.restaurant,
      data: data,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 3,
      pointRadius: 4,
      tension: 0.25,
      spanGaps: true
    };
  });

  var ctx = canvas.getContext('2d');
  if (chart) chart.destroy();
  try {
    chart = new Chart(ctx, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#eef0f3', font: { size: 16 }, boxWidth: 20 }
          },
          title: {
            display: true, text: METRIC_LABELS[currentMetric],
            color: '#eef0f3', font: { size: 22, weight: '600' }, padding: { bottom: 16 }
          }
        },
        scales: {
          x: { ticks: { color: '#8a8f99', font: { size: 14 } }, grid: { color: '#262a33' } },
          y: { ticks: { color: '#8a8f99', font: { size: 14 } }, grid: { color: '#262a33' } }
        }
      }
    });
  } catch (err) {
    showTabloMessage('Ошибка отрисовки графика: ' + err.message);
  }
}

function renderTechInfoPage() {
  var page = document.getElementById('tablo-techinfo');
  var empty = document.getElementById('tablo-empty');
  var info = lastTimeline && lastTimeline.techInfo;

  if (!info) {
    empty.textContent = DEFAULT_EMPTY_TEXT;
    empty.classList.remove('hidden');
    page.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  page.classList.remove('hidden');

  function item(label, value, small) {
    return '<div class="techinfo-item"><div class="techinfo-label">' + label + '</div>' +
      '<div class="techinfo-value">' + value + (small ? ' <small>' + small + '</small>' : '') + '</div></div>';
  }

  var html = '<div class="techinfo-title">Технические данные (общие для всех)</div><div class="techinfo-grid">';
  html += item('Игроков', info.playersCount);
  html += item('Всего клиентов на рынке в этом месяце', info.currentMarketTotal !== null ? info.currentMarketTotal.toLocaleString('ru-RU') : '—');
  html += item('Референсная цена', info.pRef.thb.toLocaleString('ru-RU') + ' ฿');
  html += item('Базовая себестоимость блюда', info.cogsBase.thb.toLocaleString('ru-RU') + ' ฿', 'растёт с качеством');
  html += item('Аренда', info.rent.thb.toLocaleString('ru-RU') + ' ฿/мес');
  html += item('ФОТ', info.payroll.thb.toLocaleString('ru-RU') + ' ฿/мес');
  html += item('Базовая ёмкость', info.capacityBase.toLocaleString('ru-RU'), 'шаг смены: ' + info.capacityStep.toLocaleString('ru-RU'));
  html += item('Стартовый капитал', info.startCapital.thb.toLocaleString('ru-RU') + ' ฿');
  html += item('Ставка банка', Math.round(info.loanRateAnnual * 100) + '%');
  html += item('Раунд / партия', info.roundDurationMin + ' мин', info.totalRounds + ' мес.');
  html += '</div>';

  if (info.marketing) {
    var mk = info.marketing;
    html += '<div class="techinfo-title" style="margin-top:22px;">Маркетинговые каналы</div><div class="techinfo-grid">';
    html += item('SEO', 'вес ' + mk.seo.weight, 'альфа ' + mk.seo.alpha + ' · опорный бюджет ' + mk.seo.refBudget.thb.toLocaleString('ru-RU') + ' ฿ · разгон ' + mk.seo.rampMonths + ' мес. · затухание ' + mk.seo.decay);
    html += item('Промоутеры', 'вес ' + mk.promo.weight, 'альфа ' + mk.promo.alpha + ' · опорный бюджет ' + mk.promo.refBudget.thb.toLocaleString('ru-RU') + ' ฿');
    html += item('Google Карты', 'вес ' + mk.maps.weight, 'альфа ' + mk.maps.alpha + ' · опорный бюджет ' + mk.maps.refBudget.thb.toLocaleString('ru-RU') + ' ฿ · затухание ' + mk.maps.decay);
    html += item('Соцсети', 'вес ' + mk.social.weight, 'альфа ' + mk.social.alpha + ' · опорный бюджет ' + mk.social.refBudget.thb.toLocaleString('ru-RU') + ' ฿ · затухание ' + mk.social.decay);
    html += item('Наружная реклама', 'вес ' + mk.outdoor.weight, 'альфа ' + mk.outdoor.alpha + ' · опорный бюджет ' + mk.outdoor.refBudget.thb.toLocaleString('ru-RU') + ' ฿ · мин. взнос ' + mk.outdoor.minSpend.thb.toLocaleString('ru-RU') + ' ฿ · срок ' + mk.outdoor.durationMonths + ' мес.');
    html += item('Партнёрская программа', Math.round(mk.affiliate.bonusPct * 100) + '% к выручке', 'мин. ежемесячный взнос ' + mk.affiliate.minSpend.thb.toLocaleString('ru-RU') + ' ฿');
    html += '</div>';
  }

  page.innerHTML = html;
}

document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentMetric = btn.getAttribute('data-metric');
    renderChart();
  });
});

loadTimeline();
setInterval(loadTimeline, 10000); // табло само обновляется по мере расчёта месяцев
