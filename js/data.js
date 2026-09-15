/* =========================================================================
   SleepAI Lab - Demo Data & Analysis Engine
   -------------------------------------------------------------------------
   실제 EEG 센서가 연결되지 않은 상태에서도 발표/시연이 가능하도록,
   Sleep-EDF / SHHS 공개 데이터셋 구조를 참고한 "샘플 PSG 레코드"를
   시드 기반 난수로 생성하고, 이를 분석한 결과(수면 단계, 수면질 점수,
   스크리닝, 맞춤 가이드)를 계산해서 반환하는 데모 엔진입니다.
   ⚠️ 실제 신호처리/딥러닝 추론이 아닌, 발표용 프로토타입 시뮬레이션입니다.
   ========================================================================= */

(function (global) {
  'use strict';

  // ---------- 시드 기반 난수 (매 시연마다 동일한 결과를 재현하기 위함) ----------
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const STAGES = ['Wake', 'REM', 'N1', 'N2', 'N3'];
  const STAGE_LABEL = { Wake: '각성(Wake)', REM: '렘수면(REM)', N1: '얕은수면(N1)', N2: '중간수면(N2)', N3: '깊은수면(N3)' };
  const STAGE_COLOR = { Wake: '#f2994a', REM: '#7c6fe0', N1: '#5bc8e0', N2: '#3d7ea6', N3: '#1f3a63' };
  const EPOCH_SEC = 30;

  // AASM 성인 정상 참고 범위 (프로토타입 안내용, 참고치)
  const NORMAL_RANGE = {
    Wake: [3, 8],
    REM: [20, 25],
    N1: [3, 8],
    N2: [45, 55],
    N3: [13, 23]
  };

  // -------------------------------------------------------------------
  // 1. 샘플 레코드 메타데이터 (Sleep-EDF / SHHS 유사 구조)
  // -------------------------------------------------------------------
  const PROFILES = [
    {
      key: 'normal',
      name: 'SC4001E0 - 건강 성인 표본',
      subtitle: '정상 수면 패턴 샘플',
      dataset: 'Sleep-EDF Expanded (simulated)',
      subject: 'Subject #4001 · 32세 · 여성',
      channels: ['EEG Fpz-Cz', 'EEG Pz-Oz', 'EOG horizontal', 'EMG submental'],
      sampleRate: '100 Hz',
      recordDate: '2026-03-11',
      duration: '8h 02m (Lights off 23:14 ~ 07:16)',
      seed: 12345,
      arousalRate: 0.03,
      sol: 11,
      targetTIB: 482,
      style: 'normal'
    },
    {
      key: 'apnea',
      name: 'ST7022J0 - 수면호흡 이상 의심 표본',
      subtitle: '잦은 각성 · 얕은 수면 우세 패턴',
      dataset: 'SHHS Polysomnography (simulated)',
      subject: 'Subject #7022 · 54세 · 남성',
      channels: ['EEG C4-A1', 'EEG C3-A2', 'EOG', 'EMG chin', 'SpO2(참고)'],
      sampleRate: '125 Hz',
      recordDate: '2026-04-02',
      duration: '7h 48m (Lights off 00:02 ~ 07:50)',
      seed: 98765,
      arousalRate: 0.14,
      sol: 18,
      targetTIB: 468,
      style: 'apnea'
    },
    {
      key: 'irregular',
      name: 'SC4092G0 - 불규칙 수면 패턴 표본',
      subtitle: '지연된 입면 · 야간 각성 구간 포함',
      dataset: 'Sleep-EDF Expanded (simulated)',
      subject: 'Subject #4092 · 27세 · 남성 (교대근무)',
      channels: ['EEG Fpz-Cz', 'EEG Pz-Oz', 'EOG horizontal', 'EMG submental'],
      sampleRate: '100 Hz',
      recordDate: '2026-02-20',
      duration: '7h 20m (Lights off 01:10 ~ 08:30)',
      seed: 55221,
      arousalRate: 0.08,
      sol: 46,
      targetTIB: 440,
      style: 'irregular'
    }
  ];

  // -------------------------------------------------------------------
  // 2. Hypnogram(수면 단계) 생성기
  // -------------------------------------------------------------------
  function pushMinutes(arr, stage, minutes) {
    const epochs = Math.max(1, Math.round((minutes * 60) / EPOCH_SEC));
    for (let i = 0; i < epochs; i++) arr.push(stage);
  }

  function jitter(rng, base, pct) {
    const delta = base * pct * (rng() * 2 - 1);
    return Math.max(0.5, base + delta);
  }

  function buildHypnogram(profile) {
    const rng = mulberry32(profile.seed);
    const stages = [];

    // 입면 전 각성 (Sleep Onset Latency)
    pushMinutes(stages, 'Wake', jitter(rng, profile.sol, 0.15));

    let cycles = 4 + Math.floor(rng() * 2); // 4~5 수면 주기
    if (profile.style === 'irregular') cycles = 3;

    for (let c = 0; c < cycles; c++) {
      const progress = c / (cycles - 1 || 1); // 0(초반) -> 1(후반)

      // N1 (얕은 진입)
      pushMinutes(stages, 'N1', jitter(rng, profile.style === 'apnea' ? 5 : 3, 0.3));

      // N2
      pushMinutes(stages, 'N2', jitter(rng, 14, 0.25));

      // N3 - 초반 주기에 많고 후반에 감소, apnea/irregular는 전반적으로 저하
      let n3base = (18 - progress * 14);
      if (profile.style === 'apnea') n3base *= 0.45;
      if (profile.style === 'irregular') n3base *= 0.6;
      if (n3base > 1.5) pushMinutes(stages, 'N3', jitter(rng, n3base, 0.3));

      pushMinutes(stages, 'N2', jitter(rng, 8, 0.3));

      // REM - 후반 주기로 갈수록 길어짐
      let remBase = 6 + progress * 18;
      if (profile.style === 'apnea') remBase *= 0.7;
      pushMinutes(stages, 'REM', jitter(rng, remBase, 0.3));

      // 각성/미세각성 삽입 (arousalRate가 높을수록 빈번)
      const arousalRoll = rng();
      if (arousalRoll < profile.arousalRate * 3) {
        pushMinutes(stages, 'Wake', jitter(rng, profile.style === 'apnea' ? 2.5 : 1.5, 0.4));
      }
      // apnea 프로파일은 각 주기 내부에도 짧은 각성을 다수 삽입 (무호흡 후 각성 패턴 모사)
      if (profile.style === 'apnea') {
        const microCount = 2 + Math.floor(rng() * 3);
        for (let m = 0; m < microCount; m++) {
          pushMinutes(stages, 'N2', jitter(rng, 4, 0.3));
          pushMinutes(stages, 'Wake', jitter(rng, 0.8, 0.5));
        }
      }
    }

    // irregular 프로파일: 야간 중간에 긴 각성 구간 삽입 (불규칙 패턴)
    if (profile.style === 'irregular') {
      const insertAt = Math.floor(stages.length * 0.55);
      const wakeBlock = [];
      pushMinutes(wakeBlock, 'Wake', jitter(rng, 22, 0.3));
      stages.splice(insertAt, 0, ...wakeBlock);
      pushMinutes(stages, 'N2', jitter(rng, 10, 0.3));
      pushMinutes(stages, 'REM', jitter(rng, 8, 0.3));
    }

    // 최종 기상
    pushMinutes(stages, 'Wake', jitter(rng, 4, 0.3));

    return scaleToTarget(stages, profile.targetTIB);
  }

  // 생성된 에폭 시퀀스를 목표 총 침상 시간(TIB, 분)에 맞춰 리샘플링
  // (프로필에 기재된 "Lights off ~ Lights on" 총 시간과 일치시키기 위함)
  function scaleToTarget(stages, targetMinutes) {
    if (!targetMinutes) return stages;
    const targetEpochs = Math.round((targetMinutes * 60) / EPOCH_SEC);
    if (targetEpochs === stages.length || stages.length === 0) return stages;
    const out = new Array(targetEpochs);
    const ratio = stages.length / targetEpochs;
    for (let i = 0; i < targetEpochs; i++) {
      out[i] = stages[Math.min(stages.length - 1, Math.floor(i * ratio))];
    }
    return out;
  }

  // -------------------------------------------------------------------
  // 3. 통계 계산
  // -------------------------------------------------------------------
  function computeStats(hypnogram) {
    const total = hypnogram.length;
    const counts = { Wake: 0, REM: 0, N1: 0, N2: 0, N3: 0 };
    hypnogram.forEach(s => counts[s]++);

    const minutesOf = s => (counts[s] * EPOCH_SEC) / 60;
    const tib = (total * EPOCH_SEC) / 60; // Time in Bed (분)
    const tst = tib - minutesOf('Wake');  // Total Sleep Time (분)
    const efficiency = Math.round((tst / tib) * 1000) / 10;

    // 입면 시간(SOL): 처음 Wake 구간 길이
    let sol = 0;
    for (const s of hypnogram) { if (s === 'Wake') sol += EPOCH_SEC / 60; else break; }

    // 중간 각성 횟수: Wake가 아닌 상태 -> Wake로 전환되는 횟수 (첫 SOL, 마지막 최종기상 제외)
    let awakenings = 0;
    for (let i = 1; i < hypnogram.length - 1; i++) {
      if (hypnogram[i] === 'Wake' && hypnogram[i - 1] !== 'Wake') awakenings++;
    }
    // 마지막 최종 기상은 카운트에서 제외 (자연 기상)
    awakenings = Math.max(0, awakenings - 1);

    // WASO: 입면 이후 ~ 최종기상 전까지의 Wake 총합 (SOL 제외, 마지막 기상 블록 제외)
    let lastSleepIdx = hypnogram.length - 1;
    while (lastSleepIdx >= 0 && hypnogram[lastSleepIdx] === 'Wake') lastSleepIdx--;
    let firstSleepIdx = 0;
    while (firstSleepIdx < hypnogram.length && hypnogram[firstSleepIdx] === 'Wake') firstSleepIdx++;
    let wasoEpochs = 0;
    for (let i = firstSleepIdx; i <= lastSleepIdx; i++) if (hypnogram[i] === 'Wake') wasoEpochs++;
    const waso = Math.round((wasoEpochs * EPOCH_SEC) / 60);

    const stagePct = {};
    STAGES.forEach(s => { stagePct[s] = Math.round((counts[s] / total) * 1000) / 10; });

    const remNremRatio = Math.round((counts.REM / (counts.N1 + counts.N2 + counts.N3)) * 1000) / 10;

    return {
      tib: Math.round(tib), tst: Math.round(tst), efficiency,
      sol: Math.round(sol), waso, awakenings,
      stageMinutes: { Wake: Math.round(minutesOf('Wake')), REM: Math.round(minutesOf('REM')), N1: Math.round(minutesOf('N1')), N2: Math.round(minutesOf('N2')), N3: Math.round(minutesOf('N3')) },
      stagePct, remNremRatio
    };
  }

  // -------------------------------------------------------------------
  // 4. 수면 질 점수 (0~100) — 여러 지표를 가중합
  // -------------------------------------------------------------------
  function computeScore(stats) {
    let score = 100;
    // 수면 효율 (목표 85%+)
    score -= Math.max(0, 88 - stats.efficiency) * 1.3;
    // 각성 횟수 (목표 3회 이하)
    score -= Math.max(0, stats.awakenings - 3) * 2.2;
    // 입면시간 (목표 20분 이하)
    score -= Math.max(0, stats.sol - 20) * 0.5;
    // 깊은 수면 비율 (목표 13~23%)
    if (stats.stagePct.N3 < NORMAL_RANGE.N3[0]) score -= (NORMAL_RANGE.N3[0] - stats.stagePct.N3) * 1.8;
    // REM 비율 (목표 20~25%)
    if (stats.stagePct.REM < NORMAL_RANGE.REM[0]) score -= (NORMAL_RANGE.REM[0] - stats.stagePct.REM) * 1.2;
    // WASO
    score -= Math.max(0, stats.waso - 20) * 0.4;

    score = Math.round(Math.max(35, Math.min(98, score)));
    let grade = '좋음';
    if (score < 60) grade = '주의 필요';
    else if (score < 75) grade = '보통';
    else if (score < 88) grade = '양호';
    else grade = '매우 좋음';
    return { score, grade };
  }

  // -------------------------------------------------------------------
  // 5. EEG 파형 & FFT/Wavelet 시각화용 데이터 생성
  // -------------------------------------------------------------------
  function buildWaveform(profile, stats) {
    const rng = mulberry32(profile.seed + 7);
    const n = 500; // 5초 구간, 100Hz 가정
    const raw = [];
    // 프로파일 특성에 따라 대역 가중치 다르게
    const weights = profile.style === 'normal'
      ? { delta: 1.4, theta: 0.6, alpha: 0.3, beta: 0.25, gamma: 0.1 }
      : profile.style === 'apnea'
        ? { delta: 0.5, theta: 0.7, alpha: 0.6, beta: 0.9, gamma: 0.3 }
        : { delta: 0.7, theta: 0.9, alpha: 0.7, beta: 0.6, gamma: 0.2 };

    for (let i = 0; i < n; i++) {
      const t = i / 100;
      let v = 0;
      v += weights.delta * Math.sin(2 * Math.PI * 1.5 * t);
      v += weights.theta * 0.7 * Math.sin(2 * Math.PI * 5.5 * t + 1);
      v += weights.alpha * 0.5 * Math.sin(2 * Math.PI * 10 * t + 2);
      v += weights.beta * 0.35 * Math.sin(2 * Math.PI * 20 * t + 0.5);
      v += weights.gamma * 0.2 * Math.sin(2 * Math.PI * 38 * t);
      v += (rng() - 0.5) * 0.25; // 노이즈
      raw.push(Math.round(v * 100) / 100);
    }

    // FFT 밴드 파워(%) - 수면단계 비율과 상관성 있게 산출
    const deltaPower = 30 + stats.stagePct.N3 * 1.6 + (rng() * 4 - 2);
    const thetaPower = 18 + stats.stagePct.N1 * 1.1 + stats.stagePct.REM * 0.4 + (rng() * 3 - 1.5);
    const alphaPower = 14 + stats.stagePct.Wake * 0.9 + (rng() * 3 - 1.5);
    const betaPower = 10 + stats.stagePct.Wake * 0.6 + stats.awakenings * 0.6 + (rng() * 3 - 1.5);
    let gammaPower = 100 - deltaPower - thetaPower - alphaPower - betaPower;
    gammaPower = Math.max(4, gammaPower);
    const sum = deltaPower + thetaPower + alphaPower + betaPower + gammaPower;
    const norm = v => Math.round((v / sum) * 1000) / 10;

    const bands = [
      { key: 'delta', label: 'Delta (0.5-4Hz)', desc: '깊은 서파수면(N3)과 밀접', value: norm(deltaPower), color: '#1f3a63' },
      { key: 'theta', label: 'Theta (4-8Hz)', desc: '얕은 수면·REM 진입 시 증가', value: norm(thetaPower), color: '#3d7ea6' },
      { key: 'alpha', label: 'Alpha (8-13Hz)', desc: '이완/각성 상태에서 우세', value: norm(alphaPower), color: '#5bc8e0' },
      { key: 'beta', label: 'Beta (13-30Hz)', desc: '각성·미세각성 시 증가', value: norm(betaPower), color: '#f2994a' },
      { key: 'gamma', label: 'Gamma (30Hz+)', desc: '고차 인지활동 관련 고주파', value: norm(gammaPower), color: '#c0577a' }
    ];

    // Wavelet 유사 시간-주파수 히트맵 (야간 전체를 20 구간으로 나눔)
    const heat = [];
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      const frac = i / segs;
      const idx = Math.floor(frac * stats._hypLength);
      const stage = stats._hyp[idx] || 'N2';
      const row = STAGES.map(band => {
        let base = 0.2;
        if (band === 'N3' && stage === 'N3') base = 0.9;
        if (band === 'N2' && (stage === 'N2' || stage === 'N3')) base = 0.6;
        if (band === 'REM' && stage === 'REM') base = 0.85;
        if (band === 'N1' && (stage === 'N1' || stage === 'REM')) base = 0.55;
        if (band === 'Wake' && stage === 'Wake') base = 0.95;
        return Math.min(1, Math.max(0.05, base + (rng() * 0.2 - 0.1)));
      });
      heat.push(row);
    }

    return { raw, bands, heat, segs };
  }

  // -------------------------------------------------------------------
  // 6. 수면 장애 스크리닝 (진단 아님 — 패턴 스크리닝만 제공)
  // -------------------------------------------------------------------
  function buildScreening(profile, stats) {
    const items = [];

    // 1) 수면무호흡 의심 패턴: 잦은 미세각성 + N1 증가 + 낮은 효율
    const apneaScore = stats.awakenings * 2 + Math.max(0, stats.stagePct.N1 - 8) * 3 + Math.max(0, 90 - stats.efficiency);
    items.push({
      key: 'apnea',
      title: '수면 무호흡 의심 패턴',
      level: apneaScore > 45 ? 'warn' : apneaScore > 25 ? 'watch' : 'normal',
      metric: `시간당 각성 추정 ${(stats.awakenings / (stats.tst / 60)).toFixed(1)}회, N1 비율 ${stats.stagePct.N1}%`,
      desc: '호흡 정지 후 발생하는 미세 각성(Arousal)과 얕은 수면 비율 증가 패턴을 기반으로 스크리닝한 결과입니다.'
    });

    // 2) 잦은 각성
    items.push({
      key: 'arousal',
      title: '잦은 각성',
      level: stats.awakenings >= 12 ? 'warn' : stats.awakenings >= 6 ? 'watch' : 'normal',
      metric: `중간 각성 ${stats.awakenings}회 · WASO ${stats.waso}분`,
      desc: '수면 중 각성 빈도와 입면 후 각성시간(WASO)이 정상 범위를 벗어나는지 확인합니다.'
    });

    // 3) 수면 구조 이상 (N3/REM 결핍)
    const structureIssue = stats.stagePct.N3 < NORMAL_RANGE.N3[0] - 3 || stats.stagePct.REM < NORMAL_RANGE.REM[0] - 5;
    items.push({
      key: 'structure',
      title: '수면 구조 이상',
      level: structureIssue ? 'warn' : (stats.stagePct.N3 < NORMAL_RANGE.N3[0] ? 'watch' : 'normal'),
      metric: `N3 ${stats.stagePct.N3}% (정상 ${NORMAL_RANGE.N3[0]}-${NORMAL_RANGE.N3[1]}%), REM ${stats.stagePct.REM}% (정상 ${NORMAL_RANGE.REM[0]}-${NORMAL_RANGE.REM[1]}%)`,
      desc: '깊은 수면(N3)과 렘수면(REM) 비율이 정상 참고범위 대비 부족한지 비교합니다.'
    });

    // 4) 불규칙 수면 패턴 (SOL 지연 + 긴 야간각성)
    items.push({
      key: 'irregular',
      title: '불규칙한 수면 패턴',
      level: stats.sol > 40 ? 'warn' : stats.sol > 25 ? 'watch' : 'normal',
      metric: `입면 시간(SOL) ${stats.sol}분`,
      desc: '입면까지 걸리는 시간과 야간 각성 분포가 불규칙한지, 생체리듬 변동 가능성을 스크리닝합니다.'
    });

    return items;
  }

  // -------------------------------------------------------------------
  // 7. 개인 맞춤형 가이드
  // -------------------------------------------------------------------
  function buildGuide(profile, stats, screening) {
    const guide = { schedule: [], environment: [], substance: [], habit: [], tonight: [] };

    // 취침/기상 시간
    if (stats.sol > 25) {
      guide.schedule.push('입면까지 시간이 길어요. 잠자리에 드는 시각을 지금보다 20~30분 늦춰 "졸릴 때 눕기"를 시도해 보세요.');
    } else {
      guide.schedule.push('현재 입면 패턴은 양호합니다. 매일 비슷한 시각에 취침·기상하여 리듬을 유지하세요.');
    }
    guide.schedule.push('주말과 평일의 기상 시각 차이를 1시간 이내로 유지하면 생체리듬 안정에 도움이 됩니다.');

    // 수면 환경
    guide.environment.push('침실 조도를 낮추고(수면등 이하), 온도는 18~20℃로 유지하면 깊은 수면(N3) 비율 개선에 도움이 됩니다.');
    if (stats.awakenings >= 6) {
      guide.environment.push('중간 각성이 잦은 편입니다. 소음 차단(백색소음/귀마개)과 침구 정리를 점검해 보세요.');
    }

    // 카페인/전자기기
    guide.substance.push('취침 6시간 전부터 카페인 섭취를 제한하면 입면 지연을 줄이는 데 도움이 됩니다.');
    guide.substance.push('취침 1시간 전 스마트폰·TV 등 청색광 노출을 줄이면 멜라토닌 분비에 유리합니다.');

    // 수면 습관
    if (stats.stagePct.N3 < NORMAL_RANGE.N3[0]) {
      guide.habit.push('깊은 수면 비율이 참고범위보다 낮습니다. 늦은 저녁 격렬한 운동을 피하고, 낮 시간 가벼운 유산소 운동을 권장합니다.');
    }
    if (stats.efficiency < 85) {
      guide.habit.push('수면 효율이 다소 낮습니다. 침대는 수면 목적으로만 사용하고, 잠들지 못하면 잠시 일어나 다른 공간에서 시간을 보내 보세요.');
    } else {
      guide.habit.push('전반적인 수면 효율이 양호합니다. 현재 루틴을 유지하는 것을 권장합니다.');
    }

    // 오늘 밤 실천 팁 (3가지)
    guide.tonight = [
      '취침 30분 전 조명을 어둡게 하고 스마트폰 사용을 멈춰보세요.',
      '가벼운 스트레칭이나 4-7-8 호흡법으로 긴장을 풀어보세요.',
      '침실 온도를 확인하고 통풍이 잘 되는지 점검해보세요.'
    ];

    const hasWarn = screening.some(s => s.level === 'warn');
    if (hasWarn) {
      guide.tonight.unshift('오늘 스크리닝에서 주의가 필요한 패턴이 확인되었습니다. 증상이 반복된다면 수면 전문 의료진 상담을 고려해 보세요.');
    }

    return guide;
  }

  // -------------------------------------------------------------------
  // 8. 최근 7일 수면 점수 추이 (대시보드용)
  // -------------------------------------------------------------------
  function buildWeeklyTrend(profile, todayScore) {
    const rng = mulberry32(profile.seed + 99);
    const days = ['월', '화', '수', '목', '금', '토', '일'];
    const trend = days.map((d, i) => {
      if (i === days.length - 1) return { day: d, score: todayScore };
      const delta = Math.round((rng() * 22) - 11);
      return { day: d, score: Math.max(40, Math.min(97, todayScore - 3 + delta)) };
    });
    return trend;
  }

  // -------------------------------------------------------------------
  // 9. 최종 분석 결과 조립 (캐싱)
  // -------------------------------------------------------------------
  const cache = {};
  function analyze(profileKey) {
    if (cache[profileKey]) return cache[profileKey];
    const profile = PROFILES.find(p => p.key === profileKey);
    if (!profile) throw new Error('Unknown profile: ' + profileKey);

    const hyp = buildHypnogram(profile);
    const stats = computeStats(hyp);
    stats._hyp = hyp;
    stats._hypLength = hyp.length;
    const score = computeScore(stats);
    const wave = buildWaveform(profile, stats);
    const screening = buildScreening(profile, stats);
    const guide = buildGuide(profile, stats, screening);
    const weeklyTrend = buildWeeklyTrend(profile, score.score);

    const result = { profile, hypnogram: hyp, stats, score, wave, screening, guide, weeklyTrend };
    cache[profileKey] = result;
    return result;
  }

  global.SleepData = {
    PROFILES, STAGES, STAGE_LABEL, STAGE_COLOR, NORMAL_RANGE, EPOCH_SEC,
    analyze
  };
})(window);
