/* =========================================================================
   SleepAI Lab - Application Logic
   화면 전환(네비게이션), 데모 분석 진행 시뮬레이션, Chart.js 렌더링
   ========================================================================= */

(function () {
  'use strict';

  const { PROFILES, STAGES, STAGE_LABEL, STAGE_COLOR, NORMAL_RANGE, analyze } = window.SleepData;

  const state = {
    profileKey: 'normal',
    result: null,
    analyzed: false,
    charts: {}
  };

  // ------------------------------------------------------------------
  // 네비게이션
  // ------------------------------------------------------------------
  const views = document.querySelectorAll('.view');
  const navLinks = document.querySelectorAll('.nav-link');

  function goTo(viewId) {
    views.forEach(v => v.classList.toggle('active', v.id === viewId));
    navLinks.forEach(l => l.classList.toggle('active', l.dataset.view === viewId));
    document.getElementById('app-shell').scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    window.scrollTo(0, 0);
    const mobileNav = document.getElementById('mobile-nav-panel');
    if (mobileNav) mobileNav.classList.remove('open');

    if (['stage', 'report', 'screening', 'guide'].includes(viewId) && !state.analyzed) {
      // 아직 분석 전이면 안내 후 분석 화면으로 유도
      showGate(viewId);
    }
  }

  function showGate(targetView) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('gate-target').textContent = viewLabel(targetView);
    document.getElementById('analyze-gate').classList.add('active');
  }

  function viewLabel(id) {
    const map = { stage: '수면 단계 분석', report: '수면 질 리포트', screening: '수면 장애 스크리닝', guide: '맞춤형 가이드' };
    return map[id] || id;
  }

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      goTo(link.dataset.view);
    });
  });

  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => goTo(btn.dataset.goto));
  });

  const hamburger = document.getElementById('hamburger-btn');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      document.getElementById('mobile-nav-panel').classList.toggle('open');
    });
  }

  // ------------------------------------------------------------------
  // 프로필 선택 카드 렌더
  // ------------------------------------------------------------------
  function renderProfileCards() {
    const wrap = document.getElementById('profile-cards');
    wrap.innerHTML = PROFILES.map(p => `
      <button class="profile-card" data-key="${p.key}" type="button">
        <div class="profile-card-icon"><i class="fa-solid fa-wave-square"></i></div>
        <div class="profile-card-body">
          <h4>${p.name}</h4>
          <p>${p.subtitle}</p>
          <div class="profile-meta">
            <span><i class="fa-regular fa-clock"></i> ${p.duration}</span>
            <span><i class="fa-solid fa-database"></i> ${p.dataset}</span>
          </div>
        </div>
        <div class="profile-card-check"><i class="fa-solid fa-circle-check"></i></div>
      </button>
    `).join('');

    wrap.querySelectorAll('.profile-card').forEach(card => {
      card.addEventListener('click', () => {
        wrap.querySelectorAll('.profile-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        state.profileKey = card.dataset.key;
        document.getElementById('start-analysis-btn').disabled = false;
        renderSampleMeta();
      });
    });
    // 기본 선택
    wrap.querySelector('.profile-card').classList.add('selected');
    renderSampleMeta();
  }

  function renderSampleMeta() {
    const p = PROFILES.find(p => p.key === state.profileKey);
    const box = document.getElementById('sample-meta');
    box.innerHTML = `
      <div class="meta-grid">
        <div><span>대상</span><strong>${p.subject}</strong></div>
        <div><span>채널</span><strong>${p.channels.join(', ')}</strong></div>
        <div><span>샘플링레이트</span><strong>${p.sampleRate}</strong></div>
        <div><span>기록일</span><strong>${p.recordDate}</strong></div>
      </div>`;
  }

  // ------------------------------------------------------------------
  // 분석 진행 시뮬레이션
  // ------------------------------------------------------------------
  const STEPS = [
    { label: 'EEG/PSG 원시 신호 로딩', icon: 'fa-file-waveform' },
    { label: '신호 전처리 및 노이즈 제거', icon: 'fa-filter' },
    { label: 'FFT / Wavelet 주파수 특징 추출', icon: 'fa-chart-line' },
    { label: 'CNN 기반 수면 단계 분류', icon: 'fa-brain' },
    { label: 'RNN 기반 시계열 패턴 분석', icon: 'fa-diagram-project' },
    { label: '이상 패턴 스크리닝', icon: 'fa-shield-heart' },
    { label: '맞춤형 리포트 생성', icon: 'fa-file-medical' }
  ];

  function startAnalysis() {
    document.getElementById('upload-panel').classList.add('hidden');
    const progressPanel = document.getElementById('progress-panel');
    progressPanel.classList.remove('hidden');
    const list = document.getElementById('progress-steps');
    list.innerHTML = STEPS.map((s, i) => `
      <li class="progress-step" data-idx="${i}">
        <span class="step-icon"><i class="fa-solid ${s.icon}"></i></span>
        <span class="step-label">${s.label}</span>
        <span class="step-status"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
      </li>`).join('');

    const bar = document.getElementById('progress-bar-fill');
    bar.style.width = '0%';

    let idx = 0;
    function stepIt() {
      if (idx > 0) {
        const prev = list.querySelector(`[data-idx="${idx - 1}"] .step-status`);
        prev.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        list.querySelector(`[data-idx="${idx - 1}"]`).classList.add('done');
      }
      if (idx >= STEPS.length) {
        bar.style.width = '100%';
        setTimeout(finishAnalysis, 500);
        return;
      }
      list.querySelector(`[data-idx="${idx}"]`).classList.add('active');
      bar.style.width = Math.round(((idx + 0.5) / STEPS.length) * 100) + '%';
      idx++;
      setTimeout(stepIt, 550);
    }
    stepIt();
  }

  function finishAnalysis() {
    state.result = analyze(state.profileKey);
    state.analyzed = true;
    document.getElementById('progress-panel').classList.add('hidden');
    document.getElementById('result-panel').classList.remove('hidden');
    renderAll();
  }

  function resetAnalysis() {
    document.getElementById('result-panel').classList.add('hidden');
    document.getElementById('upload-panel').classList.remove('hidden');
    document.getElementById('progress-panel').classList.add('hidden');
  }

  document.getElementById('start-analysis-btn').addEventListener('click', startAnalysis);
  document.getElementById('reset-analysis-btn').addEventListener('click', resetAnalysis);
  document.getElementById('gate-go-analyze').addEventListener('click', () => goTo('analyze'));

  // ------------------------------------------------------------------
  // 렌더 전체
  // ------------------------------------------------------------------
  function renderAll() {
    renderDashboard();
    renderEegResult();
    renderStageView();
    renderReportView();
    renderScreeningView();
    renderGuideView();
  }

  function destroyChart(key) {
    if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
  }

  // ---------------- Dashboard ----------------
  function renderDashboard() {
    const r = state.result;
    document.getElementById('dash-empty').classList.toggle('hidden', !!r);
    document.getElementById('dash-content').classList.toggle('hidden', !r);
    if (!r) return;

    document.getElementById('dash-score').textContent = r.score.score;
    document.getElementById('dash-grade').textContent = r.score.grade;
    document.getElementById('dash-grade').className = 'score-grade grade-' + gradeClass(r.score.grade);
    document.getElementById('dash-tst').textContent = fmtHM(r.stats.tst);
    document.getElementById('dash-eff').textContent = r.stats.efficiency + '%';
    document.getElementById('dash-awakenings').textContent = r.stats.awakenings + '회';
    document.getElementById('dash-sol').textContent = r.stats.sol + '분';
    document.getElementById('dash-sample-name').textContent = r.profile.name;

    // 수면 단계 비율 도넛
    destroyChart('dashDonut');
    const ctx = document.getElementById('dash-stage-donut').getContext('2d');
    state.charts.dashDonut = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: STAGES.map(s => STAGE_LABEL[s]),
        datasets: [{
          data: STAGES.map(s => r.stats.stagePct[s]),
          backgroundColor: STAGES.map(s => STAGE_COLOR[s]),
          borderWidth: 2, borderColor: '#fff'
        }]
      },
      options: {
        cutout: '68%',
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }
      }
    });

    // 주간 트렌드
    destroyChart('dashTrend');
    const ctx2 = document.getElementById('dash-weekly-trend').getContext('2d');
    state.charts.dashTrend = new Chart(ctx2, {
      type: 'line',
      data: {
        labels: r.weeklyTrend.map(d => d.day),
        datasets: [{
          label: '수면 질 점수',
          data: r.weeklyTrend.map(d => d.score),
          borderColor: '#3d7ea6',
          backgroundColor: 'rgba(61,126,166,0.12)',
          tension: 0.35, fill: true, pointRadius: 4,
          pointBackgroundColor: '#1f3a63'
        }]
      },
      options: {
        scales: { y: { min: 0, max: 100, ticks: { stepSize: 20 } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  function gradeClass(g) {
    if (g === '매우 좋음') return 'excellent';
    if (g === '양호') return 'good';
    if (g === '보통') return 'fair';
    return 'poor';
  }

  function fmtHM(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return `${h}시간 ${m}분`;
  }

  // ---------------- EEG 분석 결과 시각화 (분석 화면 하단) ----------------
  function renderEegResult() {
    const r = state.result;
    if (!r) return;

    // 원시 파형
    destroyChart('waveform');
    const wctx = document.getElementById('chart-waveform').getContext('2d');
    state.charts.waveform = new Chart(wctx, {
      type: 'line',
      data: {
        labels: r.wave.raw.map((_, i) => (i / 100).toFixed(2)),
        datasets: [{
          data: r.wave.raw, borderColor: '#3d7ea6', borderWidth: 1.2,
          pointRadius: 0, tension: 0.15
        }]
      },
      options: {
        animation: false,
        scales: {
          x: { ticks: { maxTicksLimit: 8, callback: v => v + 's' }, title: { display: true, text: '시간(초)' } },
          y: { title: { display: true, text: '진폭 (μV, 정규화)' } }
        },
        plugins: { legend: { display: false } }
      }
    });

    // FFT 밴드 파워 바 차트
    destroyChart('fft');
    const fctx = document.getElementById('chart-fft').getContext('2d');
    state.charts.fft = new Chart(fctx, {
      type: 'bar',
      data: {
        labels: r.wave.bands.map(b => b.label),
        datasets: [{
          data: r.wave.bands.map(b => b.value),
          backgroundColor: r.wave.bands.map(b => b.color),
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { title: { display: true, text: '상대 파워 (%)' } } }
      }
    });

    const legendWrap = document.getElementById('fft-band-desc');
    legendWrap.innerHTML = r.wave.bands.map(b => `
      <div class="band-desc-item">
        <span class="dot" style="background:${b.color}"></span>
        <div><strong>${b.label}</strong><span>${b.desc}</span></div>
        <strong class="band-val">${b.value}%</strong>
      </div>`).join('');

    // Wavelet 유사 시간-주파수 히트맵 (테이블 형태 div grid)
    const heatWrap = document.getElementById('wavelet-heatmap');
    const rowsHtml = STAGES.map((band, ri) => {
      const cells = r.wave.heat.map(row => {
        const v = row[ri];
        return `<div class="heat-cell" style="background: rgba(31,58,99,${v.toFixed(2)})" title="${(v*100).toFixed(0)}%"></div>`;
      }).join('');
      return `<div class="heat-row"><span class="heat-row-label">${STAGE_LABEL[band]}</span><div class="heat-cells">${cells}</div></div>`;
    }).join('');
    heatWrap.innerHTML = rowsHtml + `<div class="heat-axis"><span>입면</span><span>기상</span></div>`;
  }

  // ---------------- 수면 단계(Hypnogram) ----------------
  function renderStageView() {
    const r = state.result;
    if (!r) return;

    // Hypnogram: step line chart, y축은 단계 순서
    const order = ['Wake', 'REM', 'N1', 'N2', 'N3'];
    const yMap = { Wake: 4, REM: 3, N1: 2, N2: 1, N3: 0 };
    const data = r.hypnogram.map((s, i) => ({ x: i * 30 / 60, y: yMap[s] }));

    destroyChart('hypnogram');
    const ctx = document.getElementById('chart-hypnogram').getContext('2d');
    state.charts.hypnogram = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          data, stepped: true, borderColor: '#1f3a63', borderWidth: 2,
          pointRadius: 0, backgroundColor: 'rgba(31,58,99,0.06)', fill: true
        }]
      },
      options: {
        animation: false,
        parsing: false,
        scales: {
          x: { type: 'linear', title: { display: true, text: '경과 시간 (분)' } },
          y: {
            min: -0.5, max: 4.5,
            afterBuildTicks: (axis) => {
              axis.ticks = [0, 1, 2, 3, 4].map(v => ({ value: v }));
            },
            ticks: {
              callback: (v) => ({ 4: 'Wake', 3: 'REM', 2: 'N1', 1: 'N2', 0: 'N3' })[Math.round(v)] ?? ''
            }
          }
        },
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      }
    });

    // 단계별 카드
    const wrap = document.getElementById('stage-breakdown');
    wrap.innerHTML = STAGES.map(s => {
      const pct = r.stats.stagePct[s];
      const [lo, hi] = NORMAL_RANGE[s];
      let cmp = 'normal-range', cmpText = '정상범위';
      if (pct < lo) { cmp = 'below-range'; cmpText = '정상범위 미만'; }
      else if (pct > hi) { cmp = 'above-range'; cmpText = '정상범위 초과'; }
      return `
        <div class="stage-card" style="--stage-color:${STAGE_COLOR[s]}">
          <div class="stage-card-head">
            <span class="stage-dot"></span>
            <h4>${STAGE_LABEL[s]}</h4>
          </div>
          <div class="stage-card-value">${pct}%</div>
          <div class="stage-card-sub">${fmtHM(r.stats.stageMinutes[s])}</div>
          <div class="stage-card-range">정상 참고범위 ${lo}-${hi}%</div>
          <div class="stage-badge ${cmp}">${cmpText}</div>
        </div>`;
    }).join('');
  }

  // ---------------- 수면 질 리포트 ----------------
  function renderReportView() {
    const r = state.result;
    if (!r) return;

    document.getElementById('report-score').textContent = r.score.score;
    document.getElementById('report-grade').textContent = r.score.grade;
    document.getElementById('report-grade').className = 'score-grade grade-' + gradeClass(r.score.grade);

    const cards = [
      { label: '수면 효율', value: r.stats.efficiency + '%', icon: 'fa-gauge-high', ref: '목표 85% 이상' },
      { label: '총 수면 시간', value: fmtHM(r.stats.tst), icon: 'fa-bed', ref: '권장 7-9시간' },
      { label: '입면 시간(SOL)', value: r.stats.sol + '분', icon: 'fa-hourglass-half', ref: '목표 20분 이하' },
      { label: '중간 각성 횟수', value: r.stats.awakenings + '회', icon: 'fa-bell', ref: '목표 3회 이하' },
      { label: 'REM/NREM 비율', value: r.stats.remNremRatio + '%', icon: 'fa-moon', ref: '참고 25-33%' },
      { label: '깊은 수면 비율(N3)', value: r.stats.stagePct.N3 + '%', icon: 'fa-water', ref: `참고 ${NORMAL_RANGE.N3[0]}-${NORMAL_RANGE.N3[1]}%` }
    ];
    document.getElementById('report-cards').innerHTML = cards.map(c => `
      <div class="report-card">
        <div class="report-card-icon"><i class="fa-solid ${c.icon}"></i></div>
        <div class="report-card-label">${c.label}</div>
        <div class="report-card-value">${c.value}</div>
        <div class="report-card-ref">${c.ref}</div>
      </div>`).join('');

    // 수면 단계 비율 막대 비교 (본인 vs 정상범위)
    destroyChart('reportCompare');
    const ctx = document.getElementById('chart-report-compare').getContext('2d');
    state.charts.reportCompare = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: STAGES.map(s => STAGE_LABEL[s]),
        datasets: [
          {
            label: '나의 수면',
            data: STAGES.map(s => r.stats.stagePct[s]),
            backgroundColor: '#3d7ea6', borderRadius: 6
          },
          {
            label: '정상 참고범위(평균)',
            data: STAGES.map(s => (NORMAL_RANGE[s][0] + NORMAL_RANGE[s][1]) / 2),
            backgroundColor: '#d7e6ee', borderRadius: 6
          }
        ]
      },
      options: {
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { title: { display: true, text: '비율(%)' } } }
      }
    });
  }

  // ---------------- 수면 장애 스크리닝 ----------------
  function renderScreeningView() {
    const r = state.result;
    if (!r) return;

    const levelMeta = {
      warn: { label: '주의 필요', cls: 'level-warn', icon: 'fa-triangle-exclamation' },
      watch: { label: '관찰 권장', cls: 'level-watch', icon: 'fa-eye' },
      normal: { label: '양호', cls: 'level-normal', icon: 'fa-circle-check' }
    };

    document.getElementById('screening-list').innerHTML = r.screening.map(item => {
      const meta = levelMeta[item.level];
      return `
        <div class="screening-card ${meta.cls}">
          <div class="screening-icon"><i class="fa-solid ${meta.icon}"></i></div>
          <div class="screening-body">
            <div class="screening-top">
              <h4>${item.title}</h4>
              <span class="screening-tag">${meta.label}</span>
            </div>
            <p class="screening-metric">${item.metric}</p>
            <p class="screening-desc">${item.desc}</p>
          </div>
        </div>`;
    }).join('');

    const hasWarn = r.screening.some(s => s.level === 'warn');
    document.getElementById('screening-summary-banner').className =
      'screening-banner ' + (hasWarn ? 'banner-warn' : 'banner-ok');
    document.getElementById('screening-summary-text').textContent = hasWarn
      ? '일부 항목에서 주의가 필요한 패턴이 스크리닝되었습니다.'
      : '현재 스크리닝된 항목은 대체로 양호한 범위입니다.';
  }

  // ---------------- 맞춤형 가이드 ----------------
  function renderGuideView() {
    const r = state.result;
    if (!r) return;
    const sections = [
      { key: 'schedule', title: '취침/기상 시간 개선', icon: 'fa-clock' },
      { key: 'environment', title: '수면 환경 개선', icon: 'fa-house-chimney' },
      { key: 'substance', title: '카페인 · 전자기기 사용 권장사항', icon: 'fa-mug-hot' },
      { key: 'habit', title: '수면 습관 개선', icon: 'fa-person-walking' }
    ];
    document.getElementById('guide-sections').innerHTML = sections.map(sec => `
      <div class="guide-card">
        <div class="guide-card-head"><i class="fa-solid ${sec.icon}"></i><h4>${sec.title}</h4></div>
        <ul>${r.guide[sec.key].map(t => `<li>${t}</li>`).join('')}</ul>
      </div>`).join('');

    document.getElementById('guide-tonight').innerHTML = r.guide.tonight.map((t, i) => `
      <li><span class="tonight-num">${i + 1}</span><span>${t}</span></li>`).join('');
  }

  // ------------------------------------------------------------------
  // 초기화
  // ------------------------------------------------------------------
  Chart.defaults.font.family = "'Pretendard', 'Noto Sans KR', sans-serif";
  Chart.defaults.color = '#5a6b7a';
  Chart.defaults.plugins.tooltip.backgroundColor = '#1f3a63';

  renderProfileCards();
  goTo('dashboard');
  renderDashboard();
})();
