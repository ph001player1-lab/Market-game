// ⚠️ Та же ссылка, что и в App.js. Меняется в двух местах при новом деплое.
var EXEC_URL = 'https://script.google.com/macros/s/AKfycbzIZTMSiRaYuU4ZRJa2uHV9Tek-tiS71KiuGMS2K_5ttwSLDNpBgssu2CSctBoZ4t8z/exec';

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

function apiGet(action) {
  return fetch(EXEC_URL + '?action=' + encodeURIComponent(action)).then(function (r) { return r.json(); });
}

function loadTimeline() {
  apiGet('timeline')
    .then(function (d) {
      if (!d.ok) return;
      lastTimeline = d;
      document.getElementById('t-round').textContent = 'Месяц ' + d.roundNumber;
      renderChart();
    })
    .catch(function () { /* тихо пробуем ещё раз на следующем тике */ });
}

function renderChart() {
  var empty = document.getElementById('tablo-empty');
  var canvas = document.getElementById('tablo-chart');
  if (!lastTimeline) return;

  var hasData = lastTimeline.players.some(function (p) { return p.series.length > 0; });
  if (!hasData) {
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
