(() => {
  'use strict';
  const SUBJ = { 국: '국세기본법', 법: '법인세법', 소: '소득세법', 부: '부가가치세법', 지: '지방세법' };
  const SUBJ_ORDER = ['국', '법', '소', '부', '지'];
  const CIRC = ['①', '②', '③', '④', '⑤'];
  const GANA = { 'ㄱ': '가', 'ㄴ': '나', 'ㄷ': '다', 'ㄹ': '라', 'ㅁ': '마', 'ㅂ': '바' };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // storage helpers (never throw)
  const store = (area) => ({
    get(k, d) { try { const v = area.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { area.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  });
  let LS, SS;
  try { LS = store(window.localStorage); } catch { LS = { get: (k, d) => d, set() {} }; }
  try { SS = store(window.sessionStorage); } catch { SS = { get: (k, d) => d, set() {} }; }

  let Q = [];
  const byId = new Map();
  const state = {
    years: new Set(), subjs: new Set(), types: new Set(['오지선다', '가나다']), order: 'seq',
    queue: [], idx: 0, answers: {}, // id -> {pick, submitted, correct}
    history: SS.get('history', []), // [{id, correct, at}]
    ox: LS.get('oxBank', []), // [{key, id, label, text, ok, stem}]
    oxOrder: 'rand', oxQueue: [], oxIdx: 0, oxDone: false,
  };

  // ---------- views ----------
  function show(view) {
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
    window.scrollTo({ top: 0 });
    if (view === 'ox') renderOxList();
    if (view === 'home') updatePool();
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) show(g.dataset.go);
  });

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1600);
  }

  // ---------- home ----------
  function chip(label, value, n, group, on) {
    return `<button class="chip${on ? ' on' : ''}" data-group="${group}" data-value="${esc(value)}">${esc(label)}<span class="n">${n}</span></button>`;
  }
  function renderHome() {
    const years = [...new Set(Q.map((q) => q.year))].sort((a, b) => b - a);
    years.forEach((y) => state.years.add(y));
    SUBJ_ORDER.forEach((s) => state.subjs.add(s));
    $('#yearChips').innerHTML = years.map((y) => chip(y + '년', y, Q.filter((q) => q.year === y).length, 'year', true)).join('');
    $('#subjChips').innerHTML = SUBJ_ORDER.map((s) => chip(SUBJ[s], s, Q.filter((q) => q.subject === s).length, 'subj', true)).join('');
    $('#typeChips').innerHTML = ['오지선다', '가나다'].map((t) => chip(t === '가나다' ? 'ㄱㄴㄷ 선택' : '오지선다', t, Q.filter((q) => q.type === t).length, 'type', true)).join('');
    updatePool();
  }
  function setOf(group) { return group === 'year' ? state.years : group === 'subj' ? state.subjs : state.types; }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('.chip[data-group]');
    if (c) {
      const set = setOf(c.dataset.group);
      const v = c.dataset.group === 'year' ? Number(c.dataset.value) : c.dataset.value;
      set.has(v) ? set.delete(v) : set.add(v);
      c.classList.toggle('on', set.has(v));
      updatePool();
    }
    const all = e.target.closest('[data-all]'); const none = e.target.closest('[data-none]');
    if (all || none) {
      const group = (all || none).dataset.all || (all || none).dataset.none;
      const set = setOf(group);
      $$(`.chip[data-group="${group}"]`).forEach((b) => {
        const v = group === 'year' ? Number(b.dataset.value) : b.dataset.value;
        all ? set.add(v) : set.delete(v);
        b.classList.toggle('on', !!all);
      });
      updatePool();
    }
  });
  $('#orderSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.order = b.dataset.order;
    $$('#orderSeg button').forEach((x) => x.classList.toggle('on', x === b));
    $('#orderHint').textContent = state.order === 'seq' ? '연도 최신순 → 문항번호순으로 출제합니다.' : '고른 범위 안에서 무작위로 섞어 출제합니다.';
  });
  function pool() {
    return Q.filter((q) => state.years.has(q.year) && state.subjs.has(q.subject) && state.types.has(q.type));
  }
  function updatePool() {
    const n = pool().length;
    $('#poolCount').textContent = n;
    $('#startBtn').disabled = n === 0;
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function sortSeq(list) {
    return list.slice().sort((a, b) => b.year - a.year || a.no - b.no);
  }
  $('#startBtn').addEventListener('click', () => {
    const p = pool();
    startQuiz(state.order === 'rand' ? shuffle(p) : sortSeq(p));
  });

  function startQuiz(list) {
    if (!list.length) { toast('풀 문제가 없어요'); return; }
    state.queue = list.map((q) => q.id);
    state.idx = 0; state.answers = {};
    show('quiz'); renderQ();
  }

  // ---------- quiz ----------
  function isSaved(key) { return state.ox.some((o) => o.key === key); }
  function plusBtn(key) {
    const on = isSaved(key);
    return `<button class="plus${on ? ' on' : ''}" data-plus="${esc(key)}" title="${on ? 'OX 장부에서 빼기' : '헷갈리는 지문 OX 장부에 담기'}" aria-label="OX 장부에 담기">${on ? '✓' : '+'}</button>`;
  }
  function renderQ() {
    const id = state.queue[state.idx];
    const q = byId.get(id);
    const a = state.answers[id] || {};
    const done = !!a.submitted;
    const total = state.queue.length;
    $('#progBar').style.width = ((state.idx + (done ? 1 : 0)) / total * 100) + '%';
    $('#progText').textContent = `${state.idx + 1} / ${total}`;
    const code = `${q.id}-${q.subject}-${q.type}`;
    let html = `<div class="q-meta"><span class="tag subj">${SUBJ[q.subject]}</span><span class="tag">${q.year}년</span><span class="tag">${q.no}번</span><span class="tag">${q.type === '가나다' ? 'ㄱㄴㄷ' : '오지선다'}</span><span class="tag code">${esc(code)}</span></div>`;
    html += `<div class="q-stem"><span class="no">${q.no}.</span>${esc(q.stem)}</div>`;
    if (q.type === '가나다') {
      html += '<div class="q-items">' + q.items.map((it) => {
        const key = `${q.id}-${GANA[it.label] || it.label}`;
        const v = done ? `<span class="verdict ${it.ok ? 't' : 'f'}">${it.ok ? '정' : '부'}</span>` : '';
        return `<div class="item"><span class="lab">${esc(it.label)}.</span><span class="txt">${esc(it.text)}${v}</span>${plusBtn(key)}</div>`;
      }).join('') + '</div>';
    }
    html += '<ol class="opts">' + q.options.map((o, i) => {
      const n = i + 1;
      let cls = 'opt';
      if (a.pick === n) cls += ' sel';
      if (done) {
        cls += ' locked';
        if (q.answer.includes(n)) cls += ' correct';
        else if (a.pick === n) cls += ' wrongpick';
      }
      let v = '';
      if (done && q.type === '오지선다') v = `<span class="verdict ${q.optOk[i] ? 't' : 'f'}">${q.optOk[i] ? '정' : '부'}</span>`;
      const plus = q.type === '오지선다' ? plusBtn(`${q.id}-${n}`) : '';
      return `<li class="${cls}" data-pick="${n}"><span class="num">${CIRC[i]}</span><span class="body">${esc(o)}${v}</span>${plus}</li>`;
    }).join('') + '</ol>';
    if (done) html += `<div class="stamp show ${a.correct ? 'ok' : 'no'}">${a.correct ? '정답' : '오답'}</div>`;
    $('#qcard').innerHTML = html;
    $('#prevBtn').disabled = state.idx === 0;
    $('#submitBtn').hidden = done;
    $('#submitBtn').disabled = !a.pick;
    $('#nextBtn').textContent = state.idx === total - 1 ? '결과 보기' : '다음';
  }
  $('#qcard').addEventListener('click', (e) => {
    const p = e.target.closest('[data-plus]');
    if (p) { togglePlus(p.dataset.plus); p.outerHTML = plusBtn(p.dataset.plus); return; }
    const li = e.target.closest('[data-pick]');
    if (!li) return;
    const id = state.queue[state.idx];
    const a = state.answers[id] || (state.answers[id] = {});
    if (a.submitted) return;
    a.pick = Number(li.dataset.pick);
    renderQ();
  });
  function submit() {
    const id = state.queue[state.idx]; const q = byId.get(id);
    const a = state.answers[id];
    if (!a || !a.pick || a.submitted) return;
    a.submitted = true;
    a.correct = q.answer.includes(a.pick);
    state.history.push({ id, correct: a.correct, pick: a.pick, at: Date.now() });
    SS.set('history', state.history);
    updateCounts();
    renderQ();
  }
  $('#submitBtn').addEventListener('click', submit);
  $('#prevBtn').addEventListener('click', () => { if (state.idx > 0) { state.idx--; renderQ(); } });
  $('#nextBtn').addEventListener('click', () => {
    if (state.idx < state.queue.length - 1) { state.idx++; renderQ(); } else finish();
  });
  document.addEventListener('keydown', (e) => {
    if ($('#view-quiz').hidden || e.target.closest('input,textarea') || $('#drawer').classList.contains('open')) return;
    const id = state.queue[state.idx]; const a = state.answers[id] || {};
    if (/^[1-5]$/.test(e.key) && !a.submitted) { (state.answers[id] = a).pick = Number(e.key); renderQ(); }
    else if (e.key === 'Enter') { a.submitted ? $('#nextBtn').click() : submit(); }
    else if (e.key === 'ArrowRight') $('#nextBtn').click();
    else if (e.key === 'ArrowLeft') $('#prevBtn').click();
  });

  function finish() {
    const ids = state.queue;
    const done = ids.filter((id) => state.answers[id] && state.answers[id].submitted);
    const right = done.filter((id) => state.answers[id].correct).length;
    const bySubj = {};
    done.forEach((id) => {
      const s = byId.get(id).subject;
      bySubj[s] = bySubj[s] || [0, 0]; bySubj[s][1]++; if (state.answers[id].correct) bySubj[s][0]++;
    });
    const rows = SUBJ_ORDER.filter((s) => bySubj[s]).map((s) => `<tr><td>${SUBJ[s]}</td><td>${bySubj[s][0]} / ${bySubj[s][1]}</td></tr>`).join('');
    $('#doneBody').innerHTML = `<div class="big"><em>${right}</em> / ${done.length}</div><div>제출한 ${done.length}문항 중 ${right}문항 정답 (미제출 ${ids.length - done.length})</div>` +
      (rows ? `<table class="breakdown"><tr><th>세목</th><th>정답</th></tr>${rows}</table>` : '');
    state.lastWrong = done.filter((id) => !state.answers[id].correct);
    $('#doneWrongBtn').disabled = !state.lastWrong.length;
    show('done');
  }
  $('#doneWrongBtn').addEventListener('click', () => startQuiz(state.lastWrong.map((id) => byId.get(id))));

  // ---------- history ----------
  function latestById() {
    const m = new Map();
    state.history.forEach((h) => m.set(h.id, h));
    return m;
  }
  function renderHistory() {
    const h = state.history;
    const right = h.filter((x) => x.correct).length;
    const latest = latestById();
    const wrongNow = [...latest.values()].filter((x) => !x.correct).length;
    $('#histStats').innerHTML = h.length
      ? `제출 <b>${h.length}</b>회 · 정답 <b>${right}</b> · 오답 <b>${h.length - right}</b> · 정답률 <b>${Math.round(right / h.length * 100)}%</b><br>마지막 풀이 기준 틀린 문제 <b>${wrongNow}</b>개`
      : '이번 세션에 제출한 문제가 아직 없어요.';
    $('#retryWrongBtn').disabled = wrongNow === 0;
    $('#histList').innerHTML = h.length ? h.slice().reverse().map((x, i) => {
      const q = byId.get(x.id); if (!q) return '';
      return `<li><span class="mk ${x.correct ? 'o' : 'x'}">${x.correct ? 'O' : 'X'}</span><button data-jump="${esc(x.id)}"><span class="code">${q.year}년 ${q.no}번 · ${SUBJ[q.subject]}</span><span class="s">${esc(q.stem)}</span></button></li>`;
    }).join('') : '<li class="empty">기록 없음</li>';
  }
  function openDrawer() { renderHistory(); $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); }
  function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); }
  $('#historyBtn').addEventListener('click', openDrawer);
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  $('#retryWrongBtn').addEventListener('click', () => {
    const wrong = [...latestById().values()].filter((x) => !x.correct).map((x) => byId.get(x.id));
    closeDrawer();
    startQuiz(state.order === 'rand' ? shuffle(wrong) : sortSeq(wrong));
  });
  $('#clearHistBtn').addEventListener('click', () => {
    state.history = []; SS.set('history', []); updateCounts(); renderHistory();
  });
  $('#histList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]'); if (!b) return;
    closeDrawer(); startQuiz([byId.get(b.dataset.jump)]);
  });

  // ---------- OX bank ----------
  function statementFor(key) {
    // key: "2026-01-3" or "2026-02-가"
    const m = key.match(/^(\d{4}-\d{2})-(.+)$/);
    const q = byId.get(m[1]); const label = m[2];
    if (/^\d$/.test(label)) { const i = Number(label) - 1; return { id: q.id, label, text: q.options[i], ok: q.optOk[i], stem: q.stem }; }
    const it = q.items.find((x) => (GANA[x.label] || x.label) === label);
    return { id: q.id, label, text: it.text, ok: it.ok, stem: q.stem };
  }
  function togglePlus(key) {
    const i = state.ox.findIndex((o) => o.key === key);
    if (i >= 0) { state.ox.splice(i, 1); toast('OX 장부에서 뺐어요'); }
    else { state.ox.push({ key, ...statementFor(key), addedAt: Date.now() }); toast('OX 장부에 담았어요'); }
    LS.set('oxBank', state.ox); updateCounts();
  }
  function labelText(o) { return /^\d$/.test(o.label) ? CIRC[Number(o.label) - 1] : o.label; }
  function renderOxList() {
    $('#oxStartBtn').disabled = !state.ox.length;
    $('#oxList').innerHTML = state.ox.length ? state.ox.map((o) => {
      const q = byId.get(o.id);
      return `<li><span class="src">${q.year}-${String(q.no).padStart(2, '0')} ${labelText(o)}<br>${q.subject}</span><span class="t">${esc(o.text)}</span><button class="del" data-del="${esc(o.key)}" aria-label="삭제">×</button></li>`;
    }).join('') : '<li class="empty">아직 담은 지문이 없어요. 문제 풀이 중 선지 옆 ⊕ 버튼을 눌러 보세요.</li>';
  }
  $('#oxList').addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]'); if (!d) return;
    state.ox = state.ox.filter((o) => o.key !== d.dataset.del); LS.set('oxBank', state.ox); updateCounts(); renderOxList();
  });
  $('#oxOrderSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.oxOrder = b.dataset.order; $$('#oxOrderSeg button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#oxStartBtn').addEventListener('click', () => {
    const keys = state.ox.map((o) => o.key);
    state.oxQueue = state.oxOrder === 'rand' ? shuffle(keys) : keys;
    state.oxIdx = 0; state.oxRight = 0; state.oxDone = false;
    show('oxquiz'); renderOx();
  });
  function renderOx(picked) {
    const total = state.oxQueue.length;
    if (state.oxIdx >= total) {
      $('#oxCard').innerHTML = `<div class="receipt-body"><div class="big"><em>${state.oxRight}</em> / ${total}</div><div>OX 복습을 마쳤어요.</div></div>`;
      $('#oxProgBar').style.width = '100%'; $('#oxProgText').textContent = `${total} / ${total}`;
      $('#oxNextBtn').hidden = true; return;
    }
    const key = state.oxQueue[state.oxIdx];
    const o = state.ox.find((x) => x.key === key) || statementFor(key);
    const q = byId.get(o.id);
    const answered = picked !== undefined;
    const correct = answered && (picked === o.ok);
    $('#oxProgBar').style.width = ((state.oxIdx + (answered ? 1 : 0)) / total * 100) + '%';
    $('#oxProgText').textContent = `${state.oxIdx + 1} / ${total}`;
    $('#oxCard').innerHTML =
      `<div class="q-meta"><span class="tag subj">${SUBJ[q.subject]}</span><span class="tag">${q.year}년 ${q.no}번 ${labelText(o)}</span></div>` +
      `<div class="q-stem">${esc(o.text)}</div>` +
      `<div class="ox-ctx">원문 발문: ${esc(o.stem)}</div>` +
      `<div class="ox-btns"><button class="ox-btn o${answered && picked === true ? ' picked' : ''}" data-ox="1" ${answered ? 'disabled' : ''}>O</button><button class="ox-btn x${answered && picked === false ? ' picked' : ''}" data-ox="0" ${answered ? 'disabled' : ''}>X</button></div>` +
      (answered ? `<div class="ox-result" style="color:var(${correct ? '--ok' : '--seal'})">${correct ? '정답' : '오답'} · 이 지문은 <b>${o.ok ? 'O (맞는 지문)' : 'X (틀린 지문)'}</b>이에요.</div><div class="stamp show ${correct ? 'ok' : 'no'}">${correct ? '정답' : '오답'}</div>` : '');
    $('#oxNextBtn').hidden = !answered;
  }
  $('#oxCard').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ox]'); if (!b || b.disabled) return;
    const picked = b.dataset.ox === '1';
    const key = state.oxQueue[state.oxIdx];
    const o = state.ox.find((x) => x.key === key) || statementFor(key);
    if (picked === o.ok) state.oxRight++;
    renderOx(picked);
  });
  $('#oxNextBtn').addEventListener('click', () => { state.oxIdx++; renderOx(); });

  function updateCounts() {
    $('#histCount').textContent = state.history.length;
    $('#oxCount').textContent = state.ox.length;
  }

  // ---------- boot ----------
  const d = new Date();
  $('#todayStr').textContent = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
  const data = window.QUESTIONS;
  if (!Array.isArray(data)) {
    $('#app').innerHTML = '<p style="text-align:center;padding:40px">문제 데이터(questions.js)를 불러오지 못했어요. index.html과 같은 폴더에 있는지 확인해 주세요.</p>';
  } else {
    Q = data; Q.forEach((q) => byId.set(q.id, q));
    state.ox = state.ox.filter((o) => byId.has(o.id));
    renderHome(); updateCounts(); show('home');
  }
})();
