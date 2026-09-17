/* ==========================================================================
   app.js — 더마렌즈 (DermaLens) 웹앱 로직
   --------------------------------------------------------------------------
   · 해시 라우팅 기반 단일 페이지 앱
   · 이미지 업로드 / 카메라 촬영 → 분석 진행 시각화 → 결과 → 질환 정보 → 기록
   · 분석 결과는 실제 모델 추론이 아닌 프로토타입(mock)입니다.
   ========================================================================== */

(function () {
  'use strict';

  /* ======================================================================
     0. 공통 유틸
     ====================================================================== */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  const MAX_FILE_MB = 12;
  const TABLE = 'analysis_history';
  /* 저장 키는 기존 분석 기록 유지를 위해 변경하지 않습니다. */
  const HISTORY_KEY = 'dermascan.history.v1';
  const MODEL_LABEL = 'DenseNet121 · 6가지 분류 (prototype)';

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  const TOAST_ICON = { ok: 'fa-circle-check', err: 'fa-circle-exclamation', info: 'fa-circle-info' };
  function toast(message, kind) {
    const type = kind || 'info';
    const region = $('#toast-region');
    if (!region) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', 'status');
    el.innerHTML = '<i class="fa-solid ' + TOAST_ICON[type] + '" aria-hidden="true"></i><span>' + esc(message) + '</span>';
    region.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, 3400);
  }

  /* 시드 기반 난수 — 같은 조건에서 비슷한 흐름의 결과가 나오도록 */
  function makeRandom(seed) {
    let s = Math.abs(Math.floor(seed)) % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
  }

  /* 썸네일 생성 (기록 저장용) */
  function makeThumb(dataUrl, max) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () {
        const size = max || 220;
        const scale = Math.min(1, size / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(canvas.toDataURL('image/jpeg', 0.66)); }
        catch (e) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  /* ======================================================================
     1. 앱 상태
     ====================================================================== */
  const state = {
    image: null,          // { dataUrl, name, size, dims, source }
    result: null,         // { createdAt, probs, primary, quality }
    analyzing: false,
    analyzeTab: 'upload',
    memo: '',
    recent: null          // 최근 저장된 기록
  };

  let cameraStream = null;

  /* 6가지 분류 — 원본 프로젝트 기준 (건선·아토피·여드름·주사·지루·정상) */
  function classList() {
    return DATA.diseases.map(function (d) {
      return { id: d.id, ko: d.ko, en: d.en };
    });
  }

  function diseaseById(id) {
    const found = DATA.diseases.filter(function (d) { return d.id === id; })[0];
    return found || null;
  }

  /* ======================================================================
     2. 공통 화면 컴포넌트
     ====================================================================== */
  function chip(text, variant) {
    return '<span class="chip ' + (variant || '') + '">' + esc(text) + '</span>';
  }

  function notice(html, variant) {
    return '<div class="notice ' + (variant === 'info' ? 'notice-info' : '') + '">' +
      '<i class="fa-solid ' + (variant === 'info' ? 'fa-circle-info' : 'fa-triangle-exclamation') + '" aria-hidden="true"></i>' +
      '<div>' + html + '</div></div>';
  }

  function sectionHead(eyebrow, title, desc) {
    return '<div class="section-head">' +
      '<p class="eyebrow"><i class="fa-solid fa-minus" aria-hidden="true"></i>' + esc(eyebrow) + '</p>' +
      '<h2>' + title + '</h2>' +
      (desc ? '<p>' + desc + '</p>' : '') +
      '</div>';
  }

  function iconOf(d) { return '<i class="' + d.icon + '" aria-hidden="true"></i>'; }

  function disclaimerList() {
    return '<div class="card"><h3 style="display:flex;gap:10px;align-items:center;margin-bottom:14px">' +
      '<span class="icon-badge amber"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></span> 꼭 확인해 주세요</h3>' +
      '<ul class="check-list">' +
      DATA.disclaimers.map(function (t) {
        return '<li><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span>' + esc(t) + '</span></li>';
      }).join('') +
      '</ul></div>';
  }

  function scopeCompare() {
    return '<div class="compare">' +
      '<article class="compare-card now">' +
        '<h3><span class="icon-badge"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></span> ' + esc(DATA.scope.nowTitle) + '</h3>' +
        '<p class="small muted">' + esc(DATA.scope.nowNote) + '</p>' +
        '<ul class="check-list">' +
          DATA.scope.now.map(function (t) { return '<li><i class="fa-solid fa-check" aria-hidden="true"></i><span>' + t + '</span></li>'; }).join('') +
        '</ul>' +
      '</article>' +
      '<article class="compare-card next">' +
        '<h3><span class="icon-badge violet"><i class="fa-solid fa-arrow-trend-up" aria-hidden="true"></i></span> ' + esc(DATA.scope.nextTitle) + '</h3>' +
        '<p class="small muted">' + esc(DATA.scope.nextNote) + '</p>' +
        '<ul class="check-list roadmap">' +
          DATA.scope.next.map(function (t) { return '<li><i class="fa-solid fa-arrow-right" aria-hidden="true"></i><span>' + t + '</span></li>'; }).join('') +
        '</ul>' +
      '</article>' +
    '</div>';
  }

  function scannerVisual() {
    return '<div class="scanner" aria-hidden="true">' +
      '<div class="scanner-head">' +
        '<span class="chip">DenseNet121 · 6가지 분류</span>' +
        '<span class="live"><i class="fa-solid fa-circle"></i> 분석 엔진 준비됨</span>' +
      '</div>' +
      '<div class="scanner-stage">' +
        '<div class="face-frame"><i class="fa-regular fa-face-smile"></i></div>' +
        '<div class="scan-line"></div>' +
      '</div>' +
      '<div class="scanner-tags">' +
        DATA.diseases.map(function (d) { return '<span class="chip">' + esc(d.ko) + '</span>'; }).join('') +
      '</div>' +
    '</div>';
  }

  function diseaseMiniGrid() {
    return DATA.diseases.map(function (d) {
      return '<a class="disease-mini" href="#/diseases/' + d.id + '">' +
        '<span class="icon-badge ' + (d.accent === 'teal' ? '' : d.accent) + '">' + iconOf(d) + '</span>' +
        '<span><strong>' + esc(d.ko) + '</strong><span>' + esc(d.en) + '</span></span>' +
        '<i class="fa-solid fa-chevron-right" style="margin-left:auto;color:#9db9c3" aria-hidden="true"></i>' +
      '</a>';
    }).join('');
  }

  function roadmapChips() {
    return DATA.expansionRoadmap.map(function (r) {
      return '<span class="chip chip-violet"><i class="fa-solid fa-plus" aria-hidden="true"></i> ' + esc(r.ko) + ' · ' + esc(r.en) + '</span>';
    }).join('');
  }

  /* ======================================================================
     3. 홈
     ====================================================================== */
  function viewHome() {
    return '' +
    '<section class="hero shell">' +
      '<div class="hero-grid">' +
        '<div>' +
          '<p class="eyebrow"><i class="fa-solid fa-shield-heart" aria-hidden="true"></i> AI 기반 피부질환 진단 보조</p>' +
          '<h1>사진 한 장으로 분석하는<br><span class="grad">피부질환</span></h1>' +
          '<p class="hero-sub">' + esc(DATA.service.summary) + '. 안면부 이미지를 분석해 ' +
            '6가지 분류(' + DATA.diseases.map(function (d) { return d.ko; }).join(' · ') +
            ')에 대한 소견을 확률로 정리해 보여줍니다.</p>' +
          '<div class="hero-actions">' +
            '<button class="btn btn-primary btn-lg" type="button" data-route="#/analyze">' +
              '<i class="fa-solid fa-camera-retro" aria-hidden="true"></i> 피부 분석 시작하기</button>' +
            '<a class="btn btn-ghost btn-lg" href="#/diseases">' +
              '<i class="fa-solid fa-notes-medical" aria-hidden="true"></i> 분류 클래스 보기</a>' +
          '</div>' +
          '<div class="hero-facts">' +
            '<div><strong>6가지</strong><span>분류</span></div>' +
            '<div><strong>DenseNet121</strong><span>모델 아키텍처</span></div>' +
            '<div><strong>aihub.or.kr</strong><span>학습 데이터셋</span></div>' +
          '</div>' +
        '</div>' +
        '<div>' + scannerVisual() + '</div>' +
      '</div>' +
    '</section>' +

    '<section class="section shell">' +
      sectionHead('How it works', '분석은 이렇게 진행됩니다', '이미지를 준비하면 분석 단계가 순서대로 표시되고, 완료 후 클래스별 확률과 참고 정보를 확인할 수 있습니다.') +
      '<div class="steps">' +
        '<article class="step"><h3>이미지 준비</h3><p>스마트폰 카메라로 촬영하거나 안면 사진을 업로드합니다.</p></article>' +
        '<article class="step"><h3>전처리 · 정렬</h3><p>크기와 조명을 정규화하고 안면부 영역을 정렬합니다.</p></article>' +
        '<article class="step"><h3>AI 분석</h3><p>특징 추출 후 6가지 분류에 대한 확률을 산출합니다.</p></article>' +
        '<article class="step"><h3>결과 · 기록</h3><p>상위 예측과 질환 정보를 확인하고 기록으로 저장합니다.</p></article>' +
      '</div>' +
    '</section>' +

    '<section class="section-tight shell">' +
      sectionHead('Classes', '6가지 피부질환 분류', '건선 · 아토피 · 여드름 · 주사 · 지루 · 정상 6가지 분류를 인식하는 피부질환 감지 모델을 기준으로 구성했습니다.') +
      '<div class="grid grid-3">' + diseaseMiniGrid() + '</div>' +
    '</section>' +

    '<section class="section-tight shell">' + disclaimerList() + '</section>';
  }

  /* ======================================================================
     4. 분석 화면
     ====================================================================== */
  function viewAnalyze() {
    const hasImage = !!state.image;

    return '' +
    '<section class="section-tight shell">' +
      sectionHead('Skin Analysis', '얼굴 피부 이미지 분석', '업로드 또는 촬영한 이미지를 분석해 6가지 분류에 대한 소견을 제공합니다. 스마트폰 카메라를 통한 피부 상태 평가를 지원합니다.') +

      '<div class="analyze-layout">' +
        '<div>' +
          '<div class="card">' +
            '<div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap">' +
              '<button class="btn btn-sm ' + (state.analyzeTab === 'upload' ? 'btn-primary' : 'btn-ghost') + '" type="button" data-tab="upload">' +
                '<i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i> 이미지 업로드</button>' +
              '<button class="btn btn-sm ' + (state.analyzeTab === 'camera' ? 'btn-primary' : 'btn-ghost') + '" type="button" data-tab="camera">' +
                '<i class="fa-solid fa-camera" aria-hidden="true"></i> 카메라로 촬영</button>' +
            '</div>' +

            (hasImage ? analyzePreview() : (state.analyzeTab === 'camera' ? cameraView() : uploadView())) +
          '</div>' +

          (state.analyzing ? analyzingPanel() : '') +
        '</div>' +

        '<aside>' +
          '<div class="card card-tight" style="margin-bottom:16px">' +
            '<h3 style="font-size:15.5px;margin-bottom:12px"><i class="fa-solid fa-circle-check" style="color:#0d9488" aria-hidden="true"></i> 좋은 이미지</h3>' +
            '<ul class="tip-list">' +
              DATA.guideGood.map(function (t) { return '<li class="tip"><i class="fa-solid fa-check" aria-hidden="true"></i><span>' + esc(t) + '</span></li>'; }).join('') +
            '</ul>' +
          '</div>' +
          '<div class="card card-tight">' +
            '<h3 style="font-size:15.5px;margin-bottom:12px"><i class="fa-solid fa-circle-xmark" style="color:#e11d48" aria-hidden="true"></i> 피해야 할 이미지</h3>' +
            '<ul class="tip-list">' +
              DATA.guideBad.map(function (t) { return '<li class="tip bad"><i class="fa-solid fa-xmark" aria-hidden="true"></i><span>' + esc(t) + '</span></li>'; }).join('') +
            '</ul>' +
          '</div>' +
        '</aside>' +
      '</div>' +
    '</section>';
  }

  function uploadView() {
    return '<div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="피부 이미지 업로드">' +
      '<i class="fa-solid fa-cloud-arrow-up big" aria-hidden="true"></i>' +
      '<strong>이미지를 끌어다 놓거나 클릭해 선택하세요</strong>' +
      '<p>JPG · PNG · WEBP / 최대 ' + MAX_FILE_MB + 'MB · 안면부가 정면으로 나온 사진을 권장합니다</p>' +
      '<input type="file" id="file-input" accept="image/*" class="sr-only" aria-label="이미지 파일 선택">' +
    '</div>';
  }

  function cameraView() {
    return '<div>' +
      '<div class="camera-panel" id="camera-panel">' +
        '<video id="camera-video" playsinline webkit-playsinline muted aria-label="카메라 미리보기"></video>' +
        '<div class="guide" aria-hidden="true"></div>' +
        '<p class="cam-msg" id="cam-msg">카메라를 준비하는 중입니다…</p>' +
      '</div>' +
      '<div class="button-row">' +
        '<button class="btn btn-primary" type="button" id="btn-capture" disabled>' +
          '<i class="fa-solid fa-camera" aria-hidden="true"></i> 촬영하기</button>' +
        '<button class="btn btn-ghost" type="button" id="btn-camera-retry">' +
          '<i class="fa-solid fa-rotate" aria-hidden="true"></i> 카메라 다시 연결</button>' +
      '</div>' +
      '<div style="margin-top:16px">' +
        notice('카메라 영상은 <strong>브라우저 안에서만</strong> 사용되며 서버로 전송되지 않습니다. 권한을 허용하면 안면 가이드에 맞춰 촬영하세요.', 'info') +
      '</div>' +
      '<canvas id="camera-canvas" class="sr-only" aria-hidden="true"></canvas>' +
    '</div>';
  }

  function analyzePreview() {
    const img = state.image;
    return '<div class="preview-wrap">' +
      '<span class="preview-badge">' + esc(img.source === 'camera' ? '카메라 촬영' : (img.source === 'history' ? '저장된 이미지' : '업로드된 이미지')) + '</span>' +
      '<img src="' + img.dataUrl + '" alt="분석 대상 안면 이미지 미리보기">' +
    '</div>' +

    '<dl class="metric-row" style="margin-top:18px">' +
      '<div class="metric"><dt>파일명</dt><dd style="font-size:14px" class="mono">' + esc(img.name) + '</dd></div>' +
      '<div class="metric"><dt>크기</dt><dd style="font-size:14px">' + esc(img.size) + '</dd></div>' +
      '<div class="metric"><dt>해상도</dt><dd style="font-size:14px">' + esc(img.dims || '-') + '</dd></div>' +
    '</dl>' +

    '<div class="button-row">' +
      '<button class="btn btn-primary btn-lg" type="button" id="btn-analyze"' + (state.analyzing ? ' disabled' : '') + '>' +
        '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> AI 분석 시작</button>' +
      '<button class="btn btn-ghost" type="button" id="btn-reset"' + (state.analyzing ? ' disabled' : '') + '>' +
        '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> 다른 이미지 선택</button>' +
    '</div>';
  }

  function analyzingPanel() {
    return '<div class="card" style="margin-top:18px" id="analyzing-panel">' +
      '<div class="progress-panel">' +
        '<div class="radial" id="radial" style="--p:0" role="img" aria-label="분석 진행률 0%"><span id="radial-value">0%</span></div>' +
        '<p class="task" id="task-label">분석을 준비하고 있습니다…</p>' +
        '<p class="task-sub" id="task-sub">잠시만 기다려 주세요.</p>' +
        '<div class="progress-bar"><span id="progress-fill"></span></div>' +
      '</div>' +
      '<div class="stage-track" id="stage-track">' +
        DATA.analysisStages.map(function (s, i) {
          return '<div class="stage" data-stage="' + i + '">' +
            '<span class="stage-icon"><i class="' + s.icon + '" aria-hidden="true"></i></span>' +
            '<span><strong>' + esc(s.label) + '</strong><br><span class="small muted">' + esc(s.sub) + '</span></span>' +
            '<span class="stage-state">대기</span>' +
          '</div>';
        }).join('') +
      '</div>' +
      notice('표시되는 결과는 서비스 흐름을 보여주기 위한 <strong>프로토타입(예시) 분석</strong>입니다. 실제 모델 서빙 연동은 향후 확장 예정 항목입니다.', 'info') +
    '</div>';
  }

  /* ======================================================================
     5. 결과 화면
     ====================================================================== */
  function viewResult() {
    const r = state.result;
    if (!r) {
      return '<section class="section shell" style="text-align:center">' +
        '<div class="empty-state"><i class="fa-solid fa-image" aria-hidden="true"></i>' +
        '<h2 style="font-size:20px">표시할 분석 결과가 없습니다</h2>' +
        '<p class="muted small">새로운 피부 이미지를 업로드하고 분석을 시작해 보세요.</p>' +
        '<button class="btn btn-primary" type="button" data-route="#/analyze">분석 시작하기</button></div>' +
      '</section>';
    }

    const primary = r.primary;
    const primaryDisease = diseaseById(primary.id) || DATA.diseases.filter(function (d) { return d.ko === primary.ko; })[0];
    const isNormal = primary.id === 'normal';

    const probRows = r.probs.map(function (p, idx) {
      const isTop = idx === 0;
      return '<div class="prob' + (isTop ? ' is-top' : '') + '">' +
        '<div class="prob-head">' +
          '<strong>' + esc(p.ko) + '</strong>' +
          '<span class="en">' + esc(p.en || '') + '</span>' +
          '<span class="pct">' + Number(p.score).toFixed(1) + '%</span>' +
        '</div>' +
        '<div class="prob-track"><span style="width:' + Math.max(2, Number(p.score)) + '%"></span></div>' +
      '</div>';
    }).join('');

    let diseaseBlock;
    if (isNormal) {
      diseaseBlock = '<p><strong>정상 (Normal)</strong> — 병변 소견 없음</p>' +
        '<p>' + esc(primaryDisease ? primaryDisease.description : '안면부에서 병변으로 분류할 만한 뚜렷한 소견이 관찰되지 않은 상태를 나타내는 클래스입니다.') + '</p>' +
        '<p class="small muted">정상으로 분류되더라도 자각 증상이 있다면 전문의 상담을 권장합니다. 확률은 이미지 조건에 따라 달라질 수 있습니다.</p>';
    } else if (primaryDisease) {
      diseaseBlock = '<p><strong>' + esc(primaryDisease.ko) + ' (' + esc(primaryDisease.en) + ')</strong></p>' +
        '<p>' + esc(primaryDisease.description) + '</p>' +
        '<div class="stack-pills">' + primaryDisease.tags.map(function (t) { return chip(t, 'chip-teal'); }).join('') + '</div>' +
        (primaryDisease.sourceNote ? '<p class="small muted">' + esc(primaryDisease.sourceNote) + '</p>' : '') +
        '<p class="small muted">자세한 설명은 <a href="#/diseases/' + primaryDisease.id + '" style="text-decoration:underline;color:#0f766e">질환 정보</a>에서 확인할 수 있습니다.</p>';
    } else {
      diseaseBlock = '<p>분류된 클래스에 대한 상세 정보를 찾을 수 없습니다.</p>';
    }

    return '' +
    '<section class="section-tight shell">' +
      '<div class="history-head" style="margin-bottom:20px">' +
        '<div>' +
          '<p class="eyebrow"><i class="fa-solid fa-file-medical" aria-hidden="true"></i> Analysis Result</p>' +
          '<h1 style="font-size:clamp(24px,3.4vw,34px);margin-top:8px">AI 분석 결과</h1>' +
          '<p class="muted small">분석 시각 ' + fmtDate(r.createdAt) + ' · 진단 보조용 프로토타입 결과이며 의학적 진단이 아닙니다.</p>' +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-route="#/history">' +
            '<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> 분석 기록</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" id="btn-print">' +
            '<i class="fa-solid fa-print" aria-hidden="true"></i> 인쇄 · PDF 저장</button>' +
        '</div>' +
      '</div>' +

      '<div class="result-layout">' +
        '<div>' +
          (state.image ? '<div class="result-photo"><img src="' + state.image.dataUrl + '" alt="분석한 안면 이미지">' +
            '<div class="photo-meta">' + esc(state.image.source === 'camera' ? '카메라 촬영' : state.image.name) + '</div></div>' : '') +
          '<div class="card card-tight" style="margin-top:16px">' +
            '<h3 style="font-size:15px;margin-bottom:10px">분석 메모</h3>' +
            '<label class="sr-only" for="memo-input">분석 메모</label>' +
            '<textarea id="memo-input" rows="4" style="width:100%;padding:12px;border-radius:12px;border:1px solid #cfe0e5;font:inherit;resize:vertical" placeholder="증상 부위, 발생 시점 등 기억할 내용을 적어 두세요.">' + esc(state.memo) + '</textarea>' +
            '<button class="btn btn-soft btn-sm btn-block" type="button" id="btn-save-memo" style="margin-top:10px">' +
              '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> 메모 저장</button>' +
          '</div>' +
        '</div>' +

        '<div>' +
          '<div class="result-head">' +
            '<div>' +
              '<p class="eyebrow"><i class="fa-solid fa-ranking-star" aria-hidden="true"></i> 상위 예측</p>' +
              '<h2 class="primary-name" style="margin-top:8px">' + esc(primary.ko) + '</h2>' +
              '<p class="primary-en">' + esc(primary.en || '') + '</p>' +
              '<div style="margin-top:12px">' +
                chip(isNormal ? '병변 소견 없음 (정상 범주)' : '6가지 분류 중 최고 확률', isNormal ? 'chip-teal' : 'chip-teal') +
              '</div>' +
            '</div>' +
            '<div class="confidence-dial">' +
              '<div class="value">' + Number(primary.score).toFixed(1) + '%</div>' +
              '<div class="label">Confidence</div>' +
            '</div>' +
          '</div>' +

          '<div class="card" style="margin-top:18px">' +
            '<h3 style="font-size:16px;margin-bottom:6px">클래스별 확률</h3>' +
            '<p class="small muted" style="margin-bottom:16px">건선 · 아토피 · 여드름 · 주사 · 지루 · 정상 6가지 분류 각각에 대한 예측 확률입니다. 가장 높은 값이 상위 예측으로 선택됩니다.</p>' +
            '<div class="prob-list">' + probRows + '</div>' +
          '</div>' +

          '<div class="card" style="margin-top:18px">' +
            '<h3 style="font-size:16px;margin-bottom:14px">분석 조건</h3>' +
            '<dl class="metric-row">' +
              '<div class="metric"><dt>모델</dt><dd style="font-size:14px">' + esc(MODEL_LABEL) + '</dd></div>' +
              '<div class="metric"><dt>이미지 품질</dt><dd style="font-size:14px">' + r.quality + ' / 100</dd></div>' +
              '<div class="metric"><dt>입력 해상도</dt><dd style="font-size:14px">' + esc(state.image && state.image.dims ? state.image.dims : '-') + '</dd></div>' +
            '</dl>' +
            '<p class="small muted" style="margin-top:12px"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> 병변 유형과 함께 제공될 심각도 평가, 전문의 상담 여부 안내는 향후 확장 예정 항목입니다.</p>' +
          '</div>' +

          '<div class="accordion" style="margin-top:18px">' +
            '<details class="acc-item" open>' +
              '<summary><i class="fa-solid fa-notes-medical" style="color:#0d9488" aria-hidden="true"></i> 분류 클래스 정보</summary>' +
              '<div class="acc-body">' + diseaseBlock + '</div>' +
            '</details>' +
            '<details class="acc-item">' +
              '<summary><i class="fa-solid fa-circle-info" style="color:#7c3aed" aria-hidden="true"></i> 결과 해석 안내</summary>' +
              '<div class="acc-body">' +
                '<p>표시된 확률은 이미지에서 관찰된 특징이 각 클래스에 얼마나 가까운지를 나타내는 값입니다. 확률이 높더라도 확정 진단이 아니며, 조명·각도·해상도에 따라 값이 달라질 수 있습니다.</p>' +
                '<p>상위 예측과 두 번째 예측의 차이가 작다면 여러 클래스가 유사한 특징을 공유할 수 있으므로 전문의 상담이 특히 필요합니다.</p>' +
              '</div>' +
            '</details>' +
            '<details class="acc-item">' +
              '<summary><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b" aria-hidden="true"></i> 주의사항</summary>' +
              '<div class="acc-body"><ul class="check-list">' +
                DATA.disclaimers.map(function (t) { return '<li><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span>' + esc(t) + '</span></li>'; }).join('') +
              '</ul></div>' +
            '</details>' +
          '</div>' +

          '<div class="result-actions">' +
            '<button class="btn btn-primary" type="button" data-route="#/analyze">' +
              '<i class="fa-solid fa-rotate" aria-hidden="true"></i> 다시 분석하기</button>' +
            (primaryDisease && !isNormal
              ? '<a class="btn btn-ghost" href="#/diseases/' + primaryDisease.id + '"><i class="fa-solid fa-notes-medical" aria-hidden="true"></i> 질환 정보 자세히</a>' : '') +
            '<button class="btn btn-ghost" type="button" data-route="#/history">' +
              '<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> 기록에서 확인</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  /* ======================================================================
     6. 질환(클래스) 정보
     ====================================================================== */
  function viewDiseases() {
    const cards = DATA.diseases.map(function (d) {
      return '<article class="disease-card">' +
        '<span class="icon-badge ' + (d.accent === 'teal' ? '' : d.accent) + '">' + iconOf(d) + '</span>' +
        '<div><h3>' + esc(d.ko) + '</h3><p class="en">' + esc(d.en) + ' · ' + esc(d.tagline) + '</p></div>' +
        '<div class="tag-row">' + d.tags.map(function (t) { return chip(t, 'chip-teal'); }).join('') + '</div>' +
        '<p class="desc">' + esc(d.description) + '</p>' +
        '<a class="btn btn-soft btn-sm" href="#/diseases/' + d.id + '">자세히 보기 <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>' +
      '</article>';
    }).join('');

    return '' +
    '<section class="section-tight shell">' +
      sectionHead('Class Guide', '6가지 피부질환 분류', '모델이 인식하는 6가지 분류는 건선 · 아토피 · 여드름 · 주사 · 지루 · 정상입니다. 각 분류의 특징을 확인할 수 있습니다.') +
      '<div class="disease-grid">' + cards + '</div>' +
      '<div class="card" style="margin-top:22px">' +
        '<h3 style="font-size:16px;margin-bottom:6px"><i class="fa-solid fa-diagram-successor" style="color:#7c3aed" aria-hidden="true"></i> 향후 확장 예정 질환</h3>' +
        '<p class="small muted" style="margin-bottom:12px">기획 자료에 명시된 추가 질환 모델 개발 로드맵입니다. 현재 서비스의 분류 대상은 위 6가지 분류입니다.</p>' +
        '<div class="stack-pills">' + roadmapChips() + '</div>' +
      '</div>' +
    '</section>' +
    '<section class="section-tight shell">' + disclaimerList() + '</section>';
  }

  function viewDiseaseDetail(id) {
    const d = diseaseById(id);
    if (!d) {
      return '<section class="section shell" style="text-align:center">' +
        '<div class="empty-state"><i class="fa-solid fa-circle-question" aria-hidden="true"></i>' +
        '<h2 style="font-size:20px">해당 클래스를 찾을 수 없습니다</h2>' +
        '<p class="muted small">6가지 분류(건선 · 아토피 · 여드름 · 주사 · 지루 · 정상) 중 하나를 선택해 주세요.</p>' +
        '<a class="btn btn-primary" href="#/diseases">클래스 목록으로</a></div></section>';
    }

    const related = getHistory().filter(function (h) { return h.disease_id === d.id; });
    const isNormal = d.id === 'normal';

    const relatedBlock = related.length
      ? '<div class="history-list">' + related.slice(0, 5).map(function (h) {
          return '<div class="history-item">' +
            '<span class="thumb">' + (h.thumb ? '<img src="' + h.thumb + '" alt="">' : '<i class="fa-solid fa-image" aria-hidden="true"></i>') + '</span>' +
            '<div><h3>' + fmtDate(h.analyzed_at) + '</h3>' +
            '<p class="meta"><span>신뢰도 ' + Number(h.confidence).toFixed(1) + '%</span><span>품질 ' + (h.quality || '-') + '/100</span></p></div>' +
            '<div class="pct-badge">' + Number(h.confidence).toFixed(1) + '%<small>confidence</small></div>' +
          '</div>';
        }).join('') + '</div>'
      : '<p class="small muted">이 클래스로 분류된 분석 기록이 아직 없습니다.</p>';

    return '' +
    '<section class="section-tight shell">' +
      '<a class="btn btn-ghost btn-sm" href="#/diseases" style="margin-bottom:20px">' +
        '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> 클래스 목록</a>' +
      '<div class="split">' +
        '<div>' +
          '<span class="icon-badge ' + (d.accent === 'teal' ? '' : d.accent) + '">' + iconOf(d) + '</span>' +
          '<h1 style="font-size:clamp(26px,4vw,38px);margin:16px 0 6px">' + esc(d.ko) + '</h1>' +
          '<p class="muted">' + esc(d.en) + ' · ' + esc(d.tagline) + '</p>' +
          '<div class="stack-pills" style="margin:16px 0 20px">' + d.tags.map(function (t) { return chip(t, 'chip-teal'); }).join('') + '</div>' +
          '<div class="card">' +
            '<h3 style="font-size:16px;margin-bottom:10px">클래스 설명</h3>' +
            '<p>' + esc(d.description) + '</p>' +
            (d.sourceNote ? '<p class="small muted" style="margin-top:10px">' + esc(d.sourceNote) + '</p>' : '') +
            '<hr class="divider">' +
            '<p class="small muted">이 설명은 참고용 정보이며, 의학적 진단이나 치료 정보를 제공하지 않습니다.</p>' +
          '</div>' +
          '<div class="button-row">' +
            '<button class="btn btn-primary" type="button" data-route="#/analyze"><i class="fa-solid fa-camera-retro" aria-hidden="true"></i> ' +
              (isNormal ? '내 피부 상태 분석하기' : '이 클래스 관련 분석하기') + '</button>' +
            '<a class="btn btn-ghost" href="#/history"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> 전체 분석 기록</a>' +
          '</div>' +
        '</div>' +
        '<aside>' +
          '<div class="card card-tight" style="margin-bottom:16px">' +
            '<h3 style="font-size:15.5px;margin-bottom:10px"><i class="fa-solid fa-clock-rotate-left" style="color:#0d9488" aria-hidden="true"></i> 이 클래스 분석 기록</h3>' +
            relatedBlock +
          '</div>' +
          '<div class="card card-tight">' +
            '<h3 style="font-size:15.5px;margin-bottom:10px"><i class="fa-solid fa-microscope" style="color:#7c3aed" aria-hidden="true"></i> 분류 기준</h3>' +
            '<p class="small muted">DenseNet121 기반 6가지 분류 이미지 분류 모델이 안면부 이미지에서 추출한 특징을 바탕으로 각 분류 확률을 계산합니다.</p>' +
          '</div>' +
        '</aside>' +
      '</div>' +
    '</section>' +
    '<section class="section-tight shell">' + disclaimerList() + '</section>';
  }

  /* ======================================================================
     7. 분석 기록
     ====================================================================== */
  let historyCache = [];
  let historyLoading = false;

  function getHistory() { return historyCache; }

  function readLocal() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function writeLocal(rows) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(0, 60))); } catch (e) { /* 저장 불가 시 무시 */ }
  }

  async function loadHistory() {
    historyLoading = true;
    try {
      const res = await fetch('tables/' + TABLE + '?limit=100&sort=analyzed_at');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const rows = Array.isArray(json.data) ? json.data : [];
      const local = readLocal();
      const seen = {};
      rows.forEach(function (r) { seen[r.id] = true; });
      historyCache = rows.concat(local.filter(function (r) { return !seen[r.id]; }))
        .sort(function (a, b) { return (b.analyzed_at || 0) - (a.analyzed_at || 0); });
    } catch (e) {
      historyCache = readLocal().sort(function (a, b) { return (b.analyzed_at || 0) - (a.analyzed_at || 0); });
    }
    historyLoading = false;
  }

  async function saveHistory(record) {
    try {
      const res = await fetch('tables/' + TABLE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const saved = await res.json();
      historyCache.unshift(saved);
      toast('분석 기록에 저장되었습니다.', 'ok');
      return saved;
    } catch (e) {
      const fallback = Object.assign({ id: 'local-' + Date.now() }, record);
      const local = readLocal();
      local.unshift(fallback);
      writeLocal(local);
      historyCache.unshift(fallback);
      toast('기록을 브라우저에 저장했습니다. (서버 저장 실패)', 'info');
      return fallback;
    }
  }

  async function deleteHistory(id) {
    historyCache = historyCache.filter(function (h) { return h.id !== id; });
    writeLocal(readLocal().filter(function (h) { return h.id !== id; }));
    if (String(id).indexOf('local-') !== 0) {
      try { await fetch('tables/' + TABLE + '/' + id, { method: 'DELETE' }); }
      catch (e) { /* 삭제 실패 시 화면에서는 제거 */ }
    }
  }

  function viewHistory() {
    if (historyLoading) {
      return '<section class="section-tight shell">' +
        sectionHead('History', '분석 기록', '이전 분석 결과를 다시 확인할 수 있습니다.') +
        '<div class="loading-list">' + new Array(3).fill('<div class="skeleton-row"></div>').join('') + '</div>' +
      '</section>';
    }

    const list = historyCache;
    const avg = list.length
      ? (list.reduce(function (a, h) { return a + (Number(h.confidence) || 0); }, 0) / list.length).toFixed(1) + '%'
      : '-';
    const last = list.length ? fmtDate(list[0].analyzed_at) : '-';

    const items = list.length
      ? '<div class="history-list">' + list.map(function (h) {
          const known = diseaseById(h.disease_id);
          const label = known ? known.ko : h.disease_ko;
          return '<article class="history-item">' +
            '<span class="thumb">' + (h.thumb ? '<img src="' + h.thumb + '" alt="">' : '<i class="fa-solid fa-image" aria-hidden="true"></i>') + '</span>' +
            '<div>' +
              '<h3>' + esc(label) + ' <span class="muted small">' + esc(h.disease_en || '') + '</span></h3>' +
              '<p class="meta"><span><i class="fa-solid fa-clock" aria-hidden="true"></i> ' + fmtDate(h.analyzed_at) + '</span>' +
                '<span>품질 ' + esc(h.quality || '-') + '/100</span>' +
                (h.note ? '<span><i class="fa-solid fa-pen" aria-hidden="true"></i> 메모 있음</span>' : '') + '</p>' +
              '<div class="history-actions">' +
                '<button class="btn btn-soft btn-sm" type="button" data-open-history="' + esc(h.id) + '">결과 보기</button>' +
                '<button class="btn btn-danger-soft btn-sm" type="button" data-delete-history="' + esc(h.id) + '">삭제</button>' +
              '</div>' +
            '</div>' +
            '<div class="pct-badge">' + (Number(h.confidence) || 0).toFixed(1) + '%<small>confidence</small></div>' +
          '</article>';
        }).join('') + '</div>'
      : '<div class="empty-state">' +
          '<i class="fa-solid fa-folder-open" aria-hidden="true"></i>' +
          '<h2 style="font-size:20px">아직 분석 기록이 없습니다</h2>' +
          '<p class="muted small">첫 분석을 진행하면 결과가 자동으로 이곳에 저장됩니다.</p>' +
          '<button class="btn btn-primary" type="button" data-route="#/analyze"><i class="fa-solid fa-camera-retro" aria-hidden="true"></i> 첫 분석 시작하기</button>' +
        '</div>';

    return '' +
    '<section class="section-tight shell">' +
      sectionHead('History', '분석 기록', '이전 분석 결과를 다시 확인할 수 있습니다. 분석을 완료하면 자동으로 저장됩니다.') +
      '<div class="history-summary" style="margin-bottom:22px">' +
        '<div class="summary-tile"><strong>' + list.length + '건</strong><span>저장된 분석 기록</span></div>' +
        '<div class="summary-tile"><strong>' + avg + '</strong><span>평균 신뢰도</span></div>' +
        '<div class="summary-tile"><strong style="font-size:17px">' + esc(last) + '</strong><span>가장 최근 분석</span></div>' +
      '</div>' +
      items +
      (list.length ? '<p class="small muted" style="margin-top:16px"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> 기록은 분석 기록 테이블(RESTful Table API)에 저장되며, 저장에 실패한 경우 브라우저 저장소에 보관됩니다.</p>' : '') +
    '</section>';
  }

  /* ======================================================================
     8. 프로젝트 소개
     ====================================================================== */
  function viewAbout() {
    const goalCards = DATA.goals.map(function (g) {
      return '<article class="card card-tight"><span class="icon-badge ' + g.accent + '">' +
        '<i class="' + g.icon + '" aria-hidden="true"></i></span>' +
        '<h3 style="font-size:16px;margin:12px 0 6px">' + esc(g.title) + '</h3>' +
        '<p class="small muted">' + esc(g.text) + '</p></article>';
    }).join('');

    const solutionCards = DATA.problem.solutions.map(function (s) {
      return '<article class="card card-tight"><span class="icon-badge violet">' +
        '<i class="' + s.icon + '" aria-hidden="true"></i></span>' +
        '<h3 style="font-size:16px;margin:12px 0 6px">' + esc(s.title) + '</h3>' +
        '<p class="small muted">' + esc(s.text) + '</p></article>';
    }).join('');

    return '' +
    '<section class="section-tight shell">' +
      sectionHead('About the Project', 'AI 기반 안면 피부질환 진단 보조 서비스', esc(DATA.service.summary) + ' — ' + esc(DATA.service.objective) + '.') +

      '<div class="split" style="margin-bottom:32px">' +
        '<div class="card">' +
          '<h3 style="font-size:17px;margin-bottom:10px"><i class="fa-solid fa-bullseye" style="color:#0d9488" aria-hidden="true"></i> 서비스 목적</h3>' +
          '<p class="small muted">' + esc(DATA.problem.painPoints[0]) + '</p>' +
          '<hr class="divider">' +
          '<ul class="check-list">' +
            DATA.goals.map(function (g) {
              return '<li><i class="' + g.icon + '" aria-hidden="true"></i><span><b>' + esc(g.title) + '</b> — ' + esc(g.text) + '</span></li>';
            }).join('') +
          '</ul>' +
        '</div>' +
        '<div class="card">' +
          '<h3 style="font-size:17px;margin-bottom:14px"><i class="fa-solid fa-route" style="color:#7c3aed" aria-hidden="true"></i> 웹앱 화면 흐름</h3>' +
          '<div class="flow">' +
            DATA.flow.map(function (f) {
              return '<div class="flow-step"><span class="num"></span><div><h3>' + esc(f.title) + '</h3><p>' + esc(f.text) + '</p></div></div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="section-head" style="margin-top:40px"><h2 style="font-size:22px">이 프로젝트가 하는 일</h2>' +
        '<p>학습된 모델을 진단 보조와 연구·데이터 분석에 활용하고, 원격 진료와 개인화 서비스로 확장하는 것을 목표로 합니다.</p></div>' +
      '<div class="grid grid-4">' + goalCards + '</div>' +

      '<div class="section-head" style="margin-top:40px"><h2 style="font-size:22px">왜 필요한가</h2>' +
        '<p>' + esc(DATA.problem.painPoints[0]) + ' ' + esc(DATA.problem.painPoints[1]) + '</p></div>' +
      '<div class="grid grid-3">' + solutionCards + '</div>' +

      '<div class="section-head" style="margin-top:40px"><h2 style="font-size:22px">프로젝트 결과물</h2></div>' +
      '<div class="card"><ul class="check-list">' +
        DATA.deliverables.map(function (d) {
          return '<li><i class="' + d.icon + '" aria-hidden="true"></i><span>' + d.text + '</span></li>';
        }).join('') +
      '</ul></div>' +

      '<div class="section-head" style="margin-top:40px"><h2 style="font-size:22px">AI 모델 및 기술 구성</h2></div>' +
      '<div class="grid grid-3">' +
        DATA.tech.map(function (t) {
          return '<article class="tech-card">' +
            '<h3><span class="icon-badge ' + t.accent + '"><i class="' + t.icon + '" aria-hidden="true"></i></span> ' + esc(t.title) + '</h3>' +
            '<p class="small muted">' + esc(t.detail) + '</p></article>';
        }).join('') +
      '</div>' +
      '<div class="stack-pills" style="margin-top:18px">' +
        DATA.stackPills.map(function (p) { return chip(p); }).join('') +
      '</div>' +

      '<div class="section-head" style="margin-top:40px"><h2 style="font-size:22px">구현 범위 구분</h2><p>' + esc(DATA.scope.footnote) + '</p></div>' +
      scopeCompare() +

      '<div class="card" style="margin-top:22px">' +
        '<h3 style="font-size:16px;margin-bottom:6px"><i class="fa-solid fa-diagram-successor" style="color:#7c3aed" aria-hidden="true"></i> 확장 로드맵 — 추가 질환 모델</h3>' +
        '<p class="small muted" style="margin-bottom:12px">기획 자료에 명시된 추가 질환 개발 로드맵입니다.</p>' +
        '<div class="stack-pills">' + roadmapChips() + '</div>' +
      '</div>' +

      '<div style="margin-top:34px" class="grid grid-2">' +
        '<div class="disclaimer-card">' +
          '<h3><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> 의료정보 안내</h3>' +
          '<ul class="check-list">' +
            DATA.disclaimers.map(function (t) { return '<li><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span>' + esc(t) + '</span></li>'; }).join('') +
          '</ul>' +
        '</div>' +
        '<div class="card">' +
          '<h3 style="font-size:17px;margin-bottom:10px"><i class="fa-solid fa-flask" style="color:#0d9488" aria-hidden="true"></i> 프로토타입 구현 안내</h3>' +
          '<p class="small muted">이 웹앱의 분석 결과는 실제 모델 추론이 아닌 <b>프로토타입(mock)</b>입니다. 전처리·특징 추출·클래스 분류 단계와 진행률은 실제 서비스 흐름을 보여주기 위해 재현한 것이며, 실제 모델 서빙 연동과 심각도 평가는 향후 확장 예정 항목입니다.</p>' +
          '<hr class="divider">' +
          '<p class="small muted">업로드한 이미지와 카메라 영상은 브라우저 안에서만 처리되며 외부 서버로 전송되지 않습니다. 분석 기록 저장 시에는 축소된 썸네일만 저장됩니다.</p>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  /* ======================================================================
     9. 라우팅
     ====================================================================== */
  const NAV_MAP = { '/': 'home', '/analyze': 'analyze', '/diseases': 'diseases', '/history': 'history', '/about': 'about' };

  function currentPath() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw || raw === '') return '/';
    return raw.charAt(0) === '/' ? raw : '/' + raw;
  }

  function setActiveNav(key) {
    $$('[data-nav]').forEach(function (a) {
      const isActive = a.getAttribute('data-nav') === key;
      a.classList.toggle('is-active', isActive);
      if (isActive) { a.setAttribute('aria-current', 'page'); }
      else { a.removeAttribute('aria-current'); }
    });
    const toggle = $('#nav-toggle');
    const nav = $('#primary-nav');
    if (nav) nav.classList.remove('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function render() {
    const path = currentPath();
    const root = $('#view-root');
    const detailMatch = path.match(/^\/diseases\/(.+)$/);
    let html = '';
    let navKey = NAV_MAP[path] || null;

    if (detailMatch) {
      html = viewDiseaseDetail(decodeURIComponent(detailMatch[1]));
      navKey = 'diseases';
    } else {
      switch (path) {
        case '/analyze': html = viewAnalyze(); break;
        case '/diseases': html = viewDiseases(); break;
        case '/history': html = viewHistory(); break;
        case '/about': html = viewAbout(); break;
        case '/result': html = viewResult(); navKey = 'analyze'; break;
        default: html = viewHome(); navKey = 'home';
      }
    }

    root.innerHTML = html;
    setActiveNav(navKey);
    bindView(path);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function bindView(path) {
    if (path === '/analyze') bindAnalyze();
    if (path === '/result') bindResult();
    if (path === '/history') bindHistory();
  }

  /* ======================================================================
     10. 분석 화면 이벤트
     ====================================================================== */
  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (t) { t.stop(); });
      cameraStream = null;
    }
  }

  function bindAnalyze() {
    stopCamera();

    $$('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const tab = btn.getAttribute('data-tab');
        if (tab === state.analyzeTab) return;
        state.analyzeTab = tab;
        state.image = null;
        stopCamera();
        render();
      });
    });

    const dropzone = $('#dropzone');
    const input = $('#file-input');

    if (dropzone && input) {
      dropzone.addEventListener('click', function () { input.click(); });
      dropzone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      });
      ['dragenter', 'dragover'].forEach(function (ev) {
        dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('is-drag'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove('is-drag'); });
      });
      dropzone.addEventListener('drop', function (e) {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) handleFile(files[0]);
      });
      input.addEventListener('change', function () {
        if (input.files && input.files.length) handleFile(input.files[0]);
      });
    }

    if (state.analyzeTab === 'camera' && !state.image) {
      const retry = $('#btn-camera-retry');
      if (retry) retry.addEventListener('click', function () { startCamera(); });
      startCamera();
    }

    const analyzeBtn = $('#btn-analyze');
    if (analyzeBtn) analyzeBtn.addEventListener('click', runAnalysis);

    const resetBtn = $('#btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      state.image = null;
      state.analyzing = false;
      render();
    });
  }

  function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast('이미지 파일만 업로드할 수 있습니다.', 'err');
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast('파일 용량은 ' + MAX_FILE_MB + 'MB 이하만 가능합니다.', 'err');
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      const dataUrl = String(reader.result);
      const probe = new Image();
      probe.onload = function () {
        state.image = {
          dataUrl: dataUrl,
          name: file.name,
          size: fmtSize(file.size),
          dims: probe.width + ' × ' + probe.height,
          source: 'upload'
        };
        render();
        toast('이미지를 불러왔습니다. 분석을 시작할 수 있습니다.', 'ok');
      };
      probe.onerror = function () {
        state.image = { dataUrl: dataUrl, name: file.name, size: fmtSize(file.size), dims: '-', source: 'upload' };
        render();
      };
      probe.src = dataUrl;
    };
    reader.onerror = function () { toast('이미지를 읽을 수 없습니다.', 'err'); };
    reader.readAsDataURL(file);
  }

  async function startCamera() {
    const video = $('#camera-video');
    const msg = $('#cam-msg');
    const capture = $('#btn-capture');
    if (!video) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (msg) msg.textContent = '이 브라우저에서는 카메라를 사용할 수 없습니다. 이미지 업로드를 이용해 주세요.';
      toast('카메라를 사용할 수 없습니다. 업로드를 이용해 주세요.', 'err');
      return;
    }

    stopCamera();
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      video.srcObject = cameraStream;
      await video.play().catch(function () {});
      if (msg) msg.style.display = 'none';
      if (capture) {
        capture.disabled = false;
        capture.onclick = captureFrame;
      }
    } catch (e) {
      if (msg) msg.textContent = '카메라 접근이 허용되지 않았습니다. 권한을 확인하거나 이미지 업로드를 이용해 주세요.';
      toast('카메라 권한이 필요합니다.', 'err');
    }
  }

  function captureFrame() {
    const video = $('#camera-video');
    const canvas = $('#camera-canvas');
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    state.image = {
      dataUrl: dataUrl,
      name: 'camera-' + Date.now() + '.jpg',
      size: fmtSize(Math.round(dataUrl.length * 0.75)),
      dims: video.videoWidth + ' × ' + video.videoHeight,
      source: 'camera'
    };
    stopCamera();
    render();
    toast('촬영한 이미지로 분석을 준비했습니다.', 'ok');
  }

  /* --- mock 분석 실행 --- */
  function runAnalysis() {
    if (state.analyzing || !state.image) return;
    state.analyzing = true;
    render();

    const panel = $('#analyzing-panel');
    if (!panel) return;

    const classes = classList();
    const seed = (state.image.dataUrl.length * 7919) + (Date.now() % 100000);
    const rnd = makeRandom(seed);

    /* 클래스별 가중 확률 생성 (한 클래스가 우세하도록) */
    const raw = classes.map(function () { return Math.pow(rnd(), 2.1) + 0.03; });
    const total = raw.reduce(function (a, b) { return a + b; }, 0);
    let probs = classes.map(function (c, i) {
      return { id: c.id, ko: c.ko, en: c.en, score: (raw[i] / total) * 100 };
    }).sort(function (a, b) { return b.score - a.score; });

    /* 상위 예측을 서비스다운 범위로 정규화 */
    const topTarget = 62 + rnd() * 29;
    const first = probs[0].score;
    probs = probs.map(function (p) {
      return { id: p.id, ko: p.ko, en: p.en, score: Math.min(96, p.score * (topTarget / first)) };
    });

    const quality = Math.round(78 + rnd() * 19);
    const stages = DATA.analysisStages;
    const duration = 4200;
    const startedAt = performance.now();

    const radial = $('#radial');
    const radialValue = $('#radial-value');
    const fill = $('#progress-fill');
    const taskLabel = $('#task-label');
    const taskSub = $('#task-sub');

    function tick(now) {
      if (!document.body.contains(panel)) return;
      const elapsed = now - startedAt;
      const pct = Math.max(0, Math.min(100, (elapsed / duration) * 100));

      if (radial) {
        radial.style.setProperty('--p', pct.toFixed(1));
        radial.setAttribute('aria-label', '분석 진행률 ' + Math.round(pct) + '%');
      }
      if (radialValue) radialValue.textContent = Math.round(pct) + '%';
      if (fill) fill.style.width = pct + '%';

      const stageIndex = Math.min(stages.length - 1, Math.floor(pct / (100 / stages.length)));
      stages.forEach(function (s, i) {
        const el = panel.querySelector('[data-stage="' + i + '"]');
        if (!el) return;
        const stateEl = el.querySelector('.stage-state');
        el.classList.toggle('is-active', i === stageIndex);
        el.classList.toggle('is-done', i < stageIndex);
        if (stateEl) stateEl.textContent = i < stageIndex ? '완료' : (i === stageIndex ? '진행 중' : '대기');
      });
      if (taskLabel) taskLabel.textContent = stages[stageIndex].label;
      if (taskSub) taskSub.textContent = stages[stageIndex].sub;

      if (pct < 100) {
        requestAnimationFrame(tick);
      } else {
        finishAnalysis(probs, quality);
      }
    }
    requestAnimationFrame(tick);
  }

  async function finishAnalysis(probs, quality) {
    const createdAt = Date.now();
    state.result = { createdAt: createdAt, probs: probs, primary: probs[0], quality: quality };
    state.analyzing = false;
    state.memo = '';

    const thumb = state.image ? await makeThumb(state.image.dataUrl, 220) : '';
    const record = {
      analyzed_at: createdAt,
      disease_id: probs[0].id,
      disease_ko: probs[0].ko,
      disease_en: probs[0].en,
      confidence: Math.round(probs[0].score * 10) / 10,
      quality: quality,
      probs: JSON.stringify(probs.map(function (p) { return { ko: p.ko, score: Math.round(p.score * 10) / 10 }; })),
      thumb: thumb,
      model: MODEL_LABEL,
      note: ''
    };
    state.recent = await saveHistory(record);

    location.hash = '#/result';
    render();
  }

  /* ======================================================================
     11. 결과 화면 이벤트
     ====================================================================== */
  function bindResult() {
    const print = $('#btn-print');
    if (print) print.addEventListener('click', function () { window.print(); });

    const memoBtn = $('#btn-save-memo');
    const memoInput = $('#memo-input');

    if (memoBtn && memoInput) {
      memoBtn.addEventListener('click', async function () {
        const value = memoInput.value.trim();
        state.memo = value;
        const rec = state.recent;
        if (!rec) { toast('메모를 저장할 기록이 없습니다.', 'err'); return; }

        const cached = historyCache.filter(function (h) { return h.id === rec.id; })[0];
        if (cached) cached.note = value;
        const local = readLocal();
        local.forEach(function (h) { if (h.id === rec.id) h.note = value; });
        writeLocal(local);

        if (String(rec.id).indexOf('local-') !== 0) {
          try {
            const res = await fetch('tables/' + TABLE + '/' + rec.id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ note: value })
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
          } catch (e) {
            toast('메모를 브라우저에만 저장했습니다.', 'info');
            return;
          }
        }
        toast('메모를 저장했습니다.', 'ok');
      });
    }
  }

  /* ======================================================================
     12. 기록 화면 이벤트
     ====================================================================== */
  function bindHistory() {
    $$('[data-open-history]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-open-history');
        const rec = historyCache.filter(function (h) { return h.id === id; })[0];
        if (!rec) return;

        let probs = [];
        try { probs = JSON.parse(rec.probs || '[]'); } catch (e) { probs = []; }
        if (!probs.length) {
          probs = [{ ko: rec.disease_ko, en: rec.disease_en, score: Number(rec.confidence) || 0 }];
        }
        const normalized = probs.map(function (p) {
          const known = DATA.diseases.filter(function (d) { return d.ko === p.ko; })[0];
          return { id: known ? known.id : '', ko: p.ko, en: p.en || '', score: Number(p.score) || 0 };
        }).sort(function (a, b) { return b.score - a.score; });

        state.result = {
          createdAt: rec.analyzed_at,
          probs: normalized,
          primary: normalized[0],
          quality: rec.quality
        };
        state.memo = rec.note || '';
        state.recent = rec;
        state.image = rec.thumb
          ? { dataUrl: rec.thumb, name: '저장된 이미지', size: '-', dims: '-', source: 'history' }
          : null;
        location.hash = '#/result';
        render();
        toast('저장된 분석 결과를 불러왔습니다.', 'info');
      });
    });

    $$('[data-delete-history]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        const id = btn.getAttribute('data-delete-history');
        btn.disabled = true;
        await deleteHistory(id);
        render();
        toast('기록을 삭제했습니다.', 'ok');
      });
    });
  }

  /* ======================================================================
     13. 전역 이벤트 / 초기화
     ====================================================================== */
  function init() {
    const year = $('#footer-year');
    if (year) year.textContent = new Date().getFullYear();

    document.addEventListener('click', function (e) {
      const routeBtn = e.target.closest('[data-route]');
      if (routeBtn) {
        const target = routeBtn.getAttribute('data-route');
        if (target) {
          if (target === '#/analyze' && state.analyzing) state.analyzing = false;
          if (currentPath() === target.replace('#', '')) render();
          else location.hash = target;
        }
        return;
      }

      const toggle = e.target.closest('#nav-toggle');
      if (toggle) {
        const nav = $('#primary-nav');
        if (!nav) return;
        const open = nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    });

    window.addEventListener('hashchange', function () {
      stopCamera();
      const path = currentPath();
      if (path === '/history') {
        historyLoading = true;
        render();
        loadHistory().then(function () { if (currentPath() === '/history') render(); });
        return;
      }
      render();
    });

    window.addEventListener('beforeunload', stopCamera);

    render();
    loadHistory();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
