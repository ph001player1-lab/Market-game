// ⚠️ Та же ссылка, что и в App.js. Меняется в двух местах при новом деплое.
var EXEC_URL = 'https://script.google.com/macros/s/AKfycbz1mmY8xXmhIHUmBbBhROeShcoVFioOP4qUiqRfbt3TGjnxcx-qicKi2CLP5Y_8IR41/exec';

var METRIC_LABELS = {
  profit: 'Прибыль, ฿',
  cash: 'Капитал (касса), ฿',
  marketSharePct: 'Доля рынка, %',
  served: 'Обслужено клиентов'
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

function apiGet(action) {
  return fetch(EXEC_URL + '?action=' + encodeURIComponent(action)).then(function (r) { return r.json(); });
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
      renderTechInfo(d.techInfo);
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
  var mktTable = document.getElementById('tablo-marketing-table');

  if (currentMetric === 'marketing') {
    canvas.classList.add('hidden');
    renderMarketingTable();
    return;
  }
  mktTable.classList.add('hidden');

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

function renderTechInfo(info) {
  var el = document.getElementById('tablo-techinfo');
  if (!info) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML =
    '<div class="techinfo-title">Технические данные (общие для всех)</div>' +
    'Игроков: <b>' + info.playersCount + '</b><br>' +
    'Всего клиентов на рынке в этом месяце: <b>' + (info.currentMarketTotal !== null ? info.currentMarketTotal.toLocaleString('ru-RU') : '—') + '</b><br>' +
    'Референсная цена: <b>' + info.pRef.thb.toLocaleString('ru-RU') + ' ฿</b><br>' +
    'Базовая себестоимость блюда: <b>' + info.cogsBase.thb.toLocaleString('ru-RU') + ' ฿</b> <span style="opacity:.7">(растёт с качеством)</span><br>' +
    'Аренда: <b>' + info.rent.thb.toLocaleString('ru-RU') + ' ฿/мес</b> · ФОТ: <b>' + info.payroll.thb.toLocaleString('ru-RU') + ' ฿/мес</b><br>' +
    'Базовая ёмкость: <b>' + info.capacityBase.toLocaleString('ru-RU') + '</b>, шаг смены: <b>' + info.capacityStep.toLocaleString('ru-RU') + '</b><br>' +
    'Стартовый капитал: <b>' + info.startCapital.thb.toLocaleString('ru-RU') + ' ฿</b> · Ставка банка: <b>' + Math.round(info.loanRateAnnual * 100) + '%</b><br>' +
    'Раунд: <b>' + info.roundDurationMin + ' мин</b>, партия: <b>' + info.totalRounds + ' мес.</b>';
}

function renderMarketingTable() {
  var wrap = document.getElementById('tablo-marketing-table');
  var empty = document.getElementById('tablo-empty');

  if (!lastTimeline || !lastTimeline.players.some(function (p) { return p.series.length > 0; })) {
    empty.textContent = DEFAULT_EMPTY_TEXT;
    empty.classList.remove('hidden');
    wrap.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  wrap.classList.remove('hidden');

  // Собираем все месяцы, для каждого — строку по каждому игроку.
  var roundsSet = new Set();
  lastTimeline.players.forEach(function (p) { p.series.forEach(function (pt) { roundsSet.add(pt.round); }); });
  var rounds = Array.from(roundsSet).sort(function (a, b) { return b - a; }); // новые месяцы сверху

  var html = '';
  rounds.forEach(function (round) {
    html += '<div class="marketing-month-block">';
    html += '<div class="marketing-month-title">Месяц ' + round + '</div>';
    html += '<table class="marketing-table"><thead><tr>' +
      '<th>Игрок</th><th class="num">Цена</th><th class="num">Бюджет на рекламу</th>' +
      '<th>Стратегия</th><th class="num">Рекламный эффект</th></tr></thead><tbody>';
    lastTimeline.players.forEach(function (p) {
      var pt = p.series.find(function (s) { return s.round === round; });
      if (!pt) return;
      html += '<tr><td>' + p.restaurant + '</td>' +
        '<td class="num">' + pt.price.toLocaleString('ru-RU') + ' ฿</td>' +
        '<td class="num">' + pt.marketingBudget.toLocaleString('ru-RU') + ' ฿</td>' +
        '<td>' + pt.marketingStrategy + '</td>' +
        '<td class="num">' + pt.marketingEffect.toFixed(2) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  });
  wrap.innerHTML = html;
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
