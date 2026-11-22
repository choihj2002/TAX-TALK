(() => {
  'use strict';
  const SUBJ = { 국: '국세기본법', 법: '법인세법', 소: '소득세법', 부: '부가가치세법', 상: '상속세및증여세법', 지: '지방세법' };
  const SUBJ_ORDER = ['국', '법', '소', '부', '상', '지'];
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
    run: null, // 지금 풀고 있는 한 번의 풀이 {startedAt, queue, entries, label, savedId}
    sessions: LS.get('quizSessions', []), // 저장한 세션 [{id, name, startedAt, endedAt, queue, entries}]
  };

  // ---------- views ----------
  function show(view) {
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
    window.scrollTo({ top: 0 });
    if (view === 'ox') renderOxList();
    if (view === 'oxstar') renderStarCards();
    if (view === 'mock') renderMock();
    if (view === 'home') updatePool();
    if (view === 'inbox') { renderBoard(); loadInquiries(); }
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

  function startQuiz(list, label = '', mock = null) {
    list = (list || []).filter(Boolean);
    if (!list.length) { toast('풀 문제가 없어요'); return; }
    state.queue = list.map((q) => q.id);
    state.idx = 0; state.answers = {};
    state.run = { startedAt: Date.now(), queue: state.queue.slice(), entries: [], label, savedId: null, mock };
    show('quiz'); renderQ();
  }

  // ---------- persistence (local or account) ----------
  // 로그아웃: 히스토리는 sessionStorage(탭), OX 장부는 localStorage(브라우저)
  // 로그인: 둘 다 Supabase 테이블(quiz_history, ox_notes)에 저장
  function saveHistoryEntry(h) {
    if (!state.user) { SS.set('history', state.history); return; }
    cloud.addHistory([h]).catch(() => toast('기록을 계정에 저장하지 못했어요'));
  }
  function clearHistoryStore() {
    if (!state.user) { SS.set('history', []); return Promise.resolve(); }
    return cloud.clearHistory();
  }
  function saveOxAdd(o) {
    if (!state.user) { LS.set('oxBank', state.ox); return; }
    cloud.addOx([o]).catch(() => toast('OX 장부를 계정에 저장하지 못했어요'));
  }
  function saveOxDel(key) {
    if (!state.user) { LS.set('oxBank', state.ox); return; }
    cloud.delOx(key).catch(() => toast('계정에서 지우지 못했어요'));
  }

  // ---------- quiz ----------
  function isSaved(key) { return state.ox.some((o) => o.key === key); }
  function plusBtn(key) {
    const on = isSaved(key);
    return `<button class="plus${on ? ' on' : ''}" data-plus="${esc(key)}" title="${on ? 'OX 장부에서 빼기' : '헷갈리는 지문 OX 장부에 담기'}" aria-label="OX 장부에 담기">${on ? '✓' : '+'}</button>`;
  }
  // ---------- 해설·개정 반영 ----------
  function explHtml(q, key) {
    const t = q.expl && q.expl[key];
    return t ? `<div class="expl"><b>해설</b>${esc(t)}</div>` : '';
  }
  function revTarget(t) { return t === 'stem' ? '발문' : t === '*' ? '선지 전체' : /^\d$/.test(t) ? CIRC[Number(t) - 1] : t; }
  function revHtml(q) {
    if (!q.rev && !q.note) return '';
    const li = (q.rev || []).map((r) => `<li><span class="rv-t">${esc(revTarget(r.t))}</span> <del>${esc(r.old)}</del> → <ins>${esc(r.new)}</ins><div class="rv-why">${esc(r.why)}</div></li>`).join('');
    return `<details class="revbox"${q.rev ? '' : ' open'}><summary>${q.rev ? `개정 반영 ${q.rev.length}건` : '참고'}</summary>${li ? `<ul>${li}</ul>` : ''}${q.note ? `<div class="rv-note">확인 필요: ${esc(q.note)}</div>` : ''}</details>`;
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
    let html = `<div class="q-meta"><span class="tag subj">${SUBJ[q.subject]}</span><span class="tag">${q.year}년</span><span class="tag">${q.no}번</span><span class="tag">${q.type === '가나다' ? 'ㄱㄴㄷ' : '오지선다'}</span><span class="tag code">${esc(code)}</span>${q.rev ? '<span class="tag rev" title="현행법에 맞게 문구를 고친 문제예요">개정 반영</span>' : ''}${askMeta(q.id)}</div>`;
    html += `<div class="q-stem"><span class="no">${q.no}.</span>${esc(q.stem)}</div>`;
    if (q.type === '가나다') {
      html += '<div class="q-items">' + q.items.map((it) => {
        const key = `${q.id}-${GANA[it.label] || it.label}`;
        const v = (done ? `<span class="verdict ${it.ok ? 't' : 'f'}">${it.ok ? '정' : '부'}</span>` : '') + (done || !inMockRun() ? optQ(q.id, GANA[it.label] || it.label) : '');
        return `<div class="item"><span class="lab">${esc(it.label)}.</span><span class="txt">${esc(it.text)}${v}${done ? explHtml(q, it.label) : ''}</span>${plusBtn(key)}</div>`;
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
      if (q.type === '오지선다' && (done || !inMockRun())) v += optQ(q.id, String(n));
      const plus = q.type === '오지선다' ? plusBtn(`${q.id}-${n}`) : '';
      const ex = done && q.type === '오지선다' ? explHtml(q, String(n)) : '';
      return `<li class="${cls}" data-pick="${n}"><span class="num">${CIRC[i]}</span><span class="body">${esc(o)}${v}${ex}</span>${plus}</li>`;
    }).join('') + '</ol>';
    if (done) html += revHtml(q) + `<div class="stamp show ${a.correct ? 'ok' : 'no'}">${a.correct ? '정답' : '오답'}</div>`;
    $('#qcard').innerHTML = html;
    $('#prevBtn').disabled = state.idx === 0;
    $('#submitBtn').hidden = done;
    $('#submitBtn').disabled = !a.pick;
    $('#nextBtn').textContent = state.idx === total - 1 ? '결과 보기' : '다음';
  }
  $('#qcard').addEventListener('click', (e) => {
    const p = e.target.closest('[data-plus]');
    if (p) { togglePlus(p.dataset.plus); p.outerHTML = plusBtn(p.dataset.plus); return; }
    const qid = state.queue[state.idx];
    if (e.target.closest('[data-ask]')) { openAsk({ qid, kind: 'problem' }); return; }
    if (e.target.closest('[data-board-q]')) { openQList(qid, null); return; }
    const bo = e.target.closest('[data-board-opt]');
    if (bo) { openQList(qid, bo.dataset.boardOpt); return; }
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
    const h = { id, correct: a.correct, pick: a.pick, at: Date.now() };
    state.history.push(h);
    saveHistoryEntry(h);
    if (state.run) {
      state.run.entries.push(h);
      if (state.run.savedId) syncRunToSession();
      else if (state.run.mock && !state.run.saving) saveRunAsSession(''); // 모의고사는 첫 제출 때 자동 저장
    }
    updateCounts();
    renderQ();
  }
  $('#submitBtn').addEventListener('click', submit);
  $('#prevBtn').addEventListener('click', () => { if (state.idx > 0) { state.idx--; renderQ(); } });
  $('#nextBtn').addEventListener('click', () => {
    if (state.idx < state.queue.length - 1) { state.idx++; renderQ(); } else finish();
  });
  document.addEventListener('keydown', (e) => {
    if ($('#view-quiz').hidden || e.target.closest('input,textarea') || $('#drawer').classList.contains('open') || !$('#authModal').hidden || !$('#askModal').hidden || !$('#qlistModal').hidden) return;
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
      const s = (byId.get(id) || {}).subject; if (!s) return;
      bySubj[s] = bySubj[s] || [0, 0]; bySubj[s][1]++; if (state.answers[id].correct) bySubj[s][0]++;
    });
    const rows = SUBJ_ORDER.filter((s) => bySubj[s]).map((s) => `<tr><td>${SUBJ[s]}</td><td>${bySubj[s][0]} / ${bySubj[s][1]}</td></tr>`).join('');
    $('#doneBody').innerHTML = `<div class="big"><em>${right}</em> / ${done.length}</div><div>제출한 ${done.length}문항 중 ${right}문항 정답 (미제출 ${ids.length - done.length})</div>` +
      (rows ? `<table class="breakdown"><tr><th>세목</th><th>정답</th></tr>${rows}</table>` : '');
    state.lastWrong = done.filter((id) => !state.answers[id].correct);
    $('#doneWrongBtn').disabled = !state.lastWrong.length;
    renderDoneSave();
    $('#doneMockBtn').hidden = !(state.run && state.run.mock);
    show('done');
  }
  $('#doneWrongBtn').addEventListener('click', () => startQuiz(state.lastWrong.map((id) => byId.get(id)), '오답 다시'));

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
      : (state.user ? '계정에 저장된 풀이 기록이 아직 없어요.' : '이번 세션에 제출한 문제가 아직 없어요.');
    $('#retryWrongBtn').disabled = wrongNow === 0;
    $('#histList').innerHTML = h.length ? h.slice().reverse().map((x, i) => {
      const q = byId.get(x.id); if (!q) return '';
      return `<li><span class="mk ${x.correct ? 'o' : 'x'}">${x.correct ? 'O' : 'X'}</span><button data-jump="${esc(x.id)}"><span class="code">${q.year}년 ${q.no}번 · ${SUBJ[q.subject]}</span><span class="s">${esc(q.stem)}</span></button></li>`;
    }).join('') : '<li class="empty">기록 없음</li>';
  }
  function openDrawer() { renderHistory(); renderSessions(); $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); }
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
  $('#clearHistBtn').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (state.user && !b.dataset.armed) {
      // 계정 기록은 모든 기기에서 지워지므로 한 번 더 누르게 함
      b.dataset.armed = '1'; b.textContent = '한 번 더 누르면 삭제';
      clearTimeout(b._t); b._t = setTimeout(() => { delete b.dataset.armed; b.textContent = '기록 비우기'; }, 3000);
      return;
    }
    delete b.dataset.armed; b.textContent = '기록 비우기';
    const prev = state.history;
    state.history = []; updateCounts(); renderHistory();
    clearHistoryStore().catch(() => { state.history = prev; updateCounts(); renderHistory(); toast('기록을 지우지 못했어요'); });
  });
  $('#histList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]'); if (!b) return;
    closeDrawer(); startQuiz([byId.get(b.dataset.jump)]);
  });

  // ---------- 저장한 세션 ----------
  // 한 번 출제해서 푼 것(run)을 이름 붙여 저장. 로그아웃: localStorage 'quizSessions', 로그인: Supabase quiz_sessions
  const fmtShort = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const fmtFull = (t) => { const d = new Date(t); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  function defaultName(run) {
    if (run.mock) return `제${run.mock.no}회 모의고사`;
    const subs = [...new Set(run.queue.map((id) => byId.get(id) && byId.get(id).subject).filter(Boolean))];
    const what = subs.length === 1 ? SUBJ[subs[0]] : subs.length === SUBJ_ORDER.length ? '전 세목' : subs.map((x) => x).join('·');
    return `${fmtShort(run.startedAt)} ${what} ${run.queue.length}문항${run.label ? ' (' + run.label + ')' : ''}`;
  }
  function sessScore(ss) {
    const right = ss.entries.filter((e) => e.correct).length;
    return { right, done: ss.entries.length, total: ss.queue.length };
  }
  function duration(ss) {
    const ms = (ss.endedAt || ss.startedAt) - ss.startedAt;
    if (ms < 60000) return '';
    const m = Math.round(ms / 60000);
    return m >= 60 ? ` · ${Math.floor(m / 60)}시간 ${m % 60}분` : ` · ${m}분`;
  }
  function runEndedAt(run) { return run.entries.length ? run.entries[run.entries.length - 1].at : run.startedAt; }
  function newSid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'l' + Date.now() + Math.random().toString(16).slice(2); }

  function saveLocalSessions() { LS.set('quizSessions', state.sessions); }
  async function saveRunAsSession(name) {
    const run = state.run;
    if (!run || !run.entries.length) { toast('제출한 문제가 있어야 저장할 수 있어요'); return false; }
    name = (name || '').trim().slice(0, 60) || defaultName(run);
    if (run.savedId) { // 이미 저장한 풀이면 이름만 바꿈
      return renameSession(run.savedId, name);
    }
    const ss = { id: newSid(), name, startedAt: run.startedAt, endedAt: runEndedAt(run), queue: run.queue.slice(), entries: run.entries.slice() };
    if (run.mock) { ss.kind = 'mock'; ss.mockNo = run.mock.no; ss.templateYear = run.mock.year; }
    if (state.user) {
      run.saving = true;
      try { const row = await cloud.addSession(ss); ss.id = row.id; } catch (err) { console.error(err); toast('세션을 계정에 저장하지 못했어요'); return false; } finally { run.saving = false; }
    }
    state.sessions.unshift(ss);
    if (!state.user) saveLocalSessions();
    run.savedId = ss.id;
    if (ss.entries.length < run.entries.length) syncRunToSession(); // 저장하는 사이 더 푼 문제 반영
    toast(run.mock ? `제${run.mock.no}회 모의고사로 저장했어요` : '세션으로 저장했어요');
    updateCounts(); renderSessions(); renderDoneSave();
    return true;
  }
  let syncTimer = null;
  function syncRunToSession() {
    const run = state.run; const ss = run && state.sessions.find((x) => x.id === run.savedId);
    if (!ss) return;
    ss.entries = run.entries.slice(); ss.endedAt = runEndedAt(run);
    if (!state.user) { saveLocalSessions(); renderSessions(); return; }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => cloud.updateSession(ss.id, { entries: ss.entries, ended_at: new Date(ss.endedAt).toISOString() }).catch(() => toast('세션 기록을 계정에 저장하지 못했어요')), 600);
    renderSessions();
  }
  async function renameSession(id, name) {
    const ss = state.sessions.find((x) => x.id === id); if (!ss) return false;
    name = name.trim().slice(0, 60); if (!name) { toast('이름을 적어 주세요'); return false; }
    const prev = ss.name; ss.name = name;
    if (state.user) {
      try { await cloud.updateSession(id, { name }); } catch { ss.name = prev; toast('이름을 바꾸지 못했어요'); renderSessions(); return false; }
    } else saveLocalSessions();
    toast('이름을 바꿨어요'); renderSessions(); renderDoneSave();
    return true;
  }
  async function deleteSession(id) {
    const i = state.sessions.findIndex((x) => x.id === id); if (i < 0) return;
    const [ss] = state.sessions.splice(i, 1);
    if (state.run && state.run.savedId === id) state.run.savedId = null;
    if (state.user) {
      try { await cloud.delSession(id); } catch { state.sessions.splice(i, 0, ss); toast('세션을 지우지 못했어요'); renderSessions(); return; }
    } else saveLocalSessions();
    toast('세션을 지웠어요'); updateCounts(); renderSessions(); renderDoneSave();
    if (!$('#view-mock').hidden) renderMock();
  }

  function renderDoneSave() {
    const run = state.run; const box = $('#doneSave'); if (!box) return;
    box.hidden = !run || !run.entries.length;
    if (!run) return;
    const ss = run.savedId && state.sessions.find((x) => x.id === run.savedId);
    $('#doneSessName').value = ss ? ss.name : defaultName(run);
    $('#doneSaveBtn').textContent = ss ? '이름 바꾸기' : '세션으로 저장';
  }
  $('#doneSaveBtn').addEventListener('click', (e) => busy(e.currentTarget, () => saveRunAsSession($('#doneSessName').value)));
  $('#doneSessName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#doneSaveBtn').click(); });

  function renderSessions() {
    if (!$('#sessList')) return;
    const run = state.run;
    const cur = run && run.entries.length ? run : null;
    const saved = cur && cur.savedId && state.sessions.find((x) => x.id === cur.savedId);
    if (cur) {
      const r = cur.entries.filter((e) => e.correct).length;
      $('#sessCur').innerHTML = `지금 풀이: <b>${fmtShort(cur.startedAt)}</b> 시작 · 맞춘 개수 <b>${r} / ${cur.entries.length}</b> (출제 ${cur.queue.length})` + (saved ? ' · <span style="color:var(--ok)">저장됨, 계속 푼 문제도 자동 반영</span>' : '');
      if (document.activeElement !== $('#sessName')) $('#sessName').value = saved ? saved.name : defaultName(cur);
      $('#sessSaveBtn').textContent = saved ? '이름 바꾸기' : '세션으로 저장';
    } else {
      $('#sessCur').textContent = '문제를 풀고 제출하면 지금 풀이를 세션으로 저장할 수 있어요.';
      $('#sessName').value = '';
    }
    $('#sessName').disabled = !cur; $('#sessSaveBtn').disabled = !cur;
    $('#sessWhere').textContent = state.user ? '세션은 계정에 저장돼 다른 기기에서도 보여요.' : '세션은 이 브라우저에 저장돼요. 로그인하면 계정으로 옮겨져요.';
    const list = state.sessions.slice().sort((a, b) => b.startedAt - a.startedAt);
    $('#sessList').innerHTML = list.length ? list.map((ss) => {
      const sc = sessScore(ss); const wrong = sc.done - sc.right; const left = sc.total - sc.done;
      const pct = sc.done ? Math.round(sc.right / sc.done * 100) : 0;
      return `<li data-sess="${esc(ss.id)}"${cur && cur.savedId === ss.id ? ' class="cur"' : ''}>
        <div class="sess-top"><span class="sess-name">${ss.kind === 'mock' ? '<span class="badge-mock">모의</span>' : ''}${esc(ss.name)}</span><span class="sess-score"><em>${sc.right}</em> / ${sc.done}</span></div>
        <div class="sess-meta">${fmtFull(ss.startedAt)}${duration(ss)} · 정답률 ${pct}% · 출제 ${sc.total}문항${left > 0 ? ` · 안 푼 문제 ${left}` : ''}</div>
        <div class="sess-acts">
          <button data-sact="wrong"${wrong ? '' : ' disabled'}>틀린 문제 다시 풀기 (${wrong})</button>
          ${left > 0 ? `<button data-sact="left">안 푼 문제 풀기 (${left})</button>` : ''}
          <button data-sact="all">전체 다시 풀기</button>
          <button data-sact="rename">이름 바꾸기</button>
          <button data-sact="del" class="danger">삭제</button>
        </div>
      </li>`;
    }).join('') : '<li class="empty">저장한 세션이 없어요.<br>위에서 지금 풀이에 이름을 붙여 저장해 보세요.</li>';
  }
  function setHistTab(t) {
    $$('#histTabs button').forEach((b) => b.classList.toggle('on', b.dataset.htab === t));
    $('#histLogPane').hidden = t !== 'log'; $('#histSessPane').hidden = t !== 'sess';
    if (t === 'sess') renderSessions();
  }
  $('#histTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setHistTab(b.dataset.htab); });
  $('#sessSaveBtn').addEventListener('click', (e) => busy(e.currentTarget, () => saveRunAsSession($('#sessName').value)));
  $('#sessName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#sessSaveBtn').click(); });
  $('#sessList').addEventListener('click', (e) => {
    const li = e.target.closest('[data-sess]'); const b = e.target.closest('button'); if (!li || !b) return;
    const ss = state.sessions.find((x) => x.id === li.dataset.sess); if (!ss) return;
    const act = b.dataset.sact;
    const qs = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);
    if (act === 'wrong' || act === 'left' || act === 'all') {
      let ids;
      if (act === 'wrong') ids = ss.entries.filter((x) => !x.correct).map((x) => x.id);
      else if (act === 'left') { const doneIds = new Set(ss.entries.map((x) => x.id)); ids = ss.queue.filter((id) => !doneIds.has(id)); }
      else ids = ss.queue.slice();
      const list = qs([...new Set(ids)]);
      closeDrawer();
      startQuiz(state.order === 'rand' ? shuffle(list) : (act === 'all' || act === 'left' ? list : sortSeq(list)),
        `${ss.name.slice(0, 20)} ${act === 'wrong' ? '오답 다시' : act === 'left' ? '이어 풀기' : '다시 풀기'}`);
      return;
    }
    if (act === 'rename') {
      if (li.querySelector('.sess-rename')) return;
      const box = document.createElement('div'); box.className = 'sess-rename';
      box.innerHTML = `<input maxlength="60" aria-label="새 이름"><button class="btn primary" data-sact="rename-ok">저장</button><button class="btn ghost" data-sact="rename-no">취소</button>`;
      li.appendChild(box); const inp = box.querySelector('input'); inp.value = ss.name; inp.focus(); inp.select();
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') box.querySelector('[data-sact="rename-ok"]').click(); if (ev.key === 'Escape') { ev.stopPropagation(); box.remove(); } });
      return;
    }
    if (act === 'rename-ok') { busy(b, () => renameSession(ss.id, li.querySelector('.sess-rename input').value)); return; }
    if (act === 'rename-no') { li.querySelector('.sess-rename').remove(); return; }
    if (act === 'del') {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '한 번 더 누르면 삭제'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '삭제'; } }, 3000); return; }
      b.disabled = true; deleteSession(ss.id);
    }
  });

  // ---------- 모의고사 ----------
  // 기준연도의 세목별 말문제 수를 빌려, 세목마다 그 수만큼 전 연도에서 무작위 출제
  const mockState = { year: 'rand' }; // 항상 무작위 연도 구성
  function compOf(year) {
    const c = {}; Q.filter((q) => q.year === year).forEach((q) => { c[q.subject] = (c[q.subject] || 0) + 1; });
    return c;
  }
  function mocks() { return state.sessions.filter((x) => x.kind === 'mock').sort((a, b) => (a.mockNo || 0) - (b.mockNo || 0) || a.startedAt - b.startedAt); }
  function nextMockNo() { return mocks().reduce((m, x) => Math.max(m, x.mockNo || 0), 0) + 1; }
  function renderMockSetup() {
    const years = [...new Set(Q.map((q) => q.year))].sort((a, b) => b - a);
    mockState.year = 'rand';
    $('#mockYearChips').innerHTML = years.map((y) => `<button class="chip${y === mockState.year ? ' on' : ''}" data-mock-year="${y}">${y}년<span class="n">${Q.filter((q) => q.year === y).length}</span></button>`).join('')
      + `<button class="chip${mockState.year === 'rand' ? ' on' : ''}" data-mock-year="rand">무작위</button>`;
    if (mockState.year === 'rand') $('#mockComp').textContent = '시작할 때마다 2017~2026년 중 한 해의 세목별 말문제 구성을 무작위로 골라요. 어느 해 구성인지는 회차 이름에 붙어요.';
    else {
      const c = compOf(mockState.year); const tot = Object.values(c).reduce((a, b) => a + b, 0);
      $('#mockComp').innerHTML = `${mockState.year}년 말문제 구성: ` + SUBJ_ORDER.filter((x) => c[x]).map((x) => `${SUBJ[x]} <b>${c[x]}</b>`).join(' · ') + ` · 합계 <b>${tot}</b>문항`;
    }
    $('#mockStartBtn').textContent = `제${nextMockNo()}회 모의고사 시작`;
  }
  $('#mockYearChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mock-year]'); if (!b) return;
    mockState.year = b.dataset.mockYear === 'rand' ? 'rand' : Number(b.dataset.mockYear);
    renderMockSetup();
  });
  $('#mockStartBtn').addEventListener('click', () => {
    const years = [...new Set(Q.map((q) => q.year))];
    const year = mockState.year === 'rand' ? years[Math.floor(Math.random() * years.length)] : mockState.year;
    const comp = compOf(year);
    const used = new Set(mocks().flatMap((m) => m.queue));
    const list = [];
    SUBJ_ORDER.forEach((sj) => {
      const n = comp[sj] || 0; if (!n) return;
      const all = Q.filter((q) => q.subject === sj);
      const fresh = shuffle(all.filter((q) => !used.has(q.id)));
      const rest = shuffle(all.filter((q) => used.has(q.id)));
      list.push(...fresh.concat(rest).slice(0, n));
    });
    startQuiz(list, '', { no: nextMockNo(), year });
    toast(`제${state.run.mock.no}회 모의고사 · ${list.length}문항`);
  });
  function mockStats(m) {
    const by = {}; const got = new Map(m.entries.map((e) => [e.id, e.correct]));
    m.queue.forEach((id) => { const q = byId.get(id); if (!q) return; const b = by[q.subject] || (by[q.subject] = [0, 0]); b[1]++; if (got.get(id)) b[0]++; });
    const right = m.queue.filter((id) => got.get(id)).length;
    return { right, total: m.queue.length, done: m.entries.length, score: m.queue.length ? Math.round(right / m.queue.length * 1000) / 10 : 0, by };
  }
  function renderMockChart(list) {
    if (!list.length) { $('#mockChart').innerHTML = '<div class="empty">아직 본 모의고사가 없어요. 위에서 제1회 모의고사를 시작해 보세요.</div>'; return; }
    const W = 640, H = 220, L = 34, R = 14, T = 14, B = 30;
    const n = list.length; const P = 18; const xs = (i) => n === 1 ? (L + (W - L - R) / 2) : L + P + i * (W - L - R - 2 * P) / (n - 1);
    const ys = (v) => T + (100 - v) * (H - T - B) / 100;
    let g = '';
    [0, 25, 50, 75, 100].forEach((v) => { g += `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}" stroke="var(--rule-2)"/><text x="${L - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`; });
    const pts = list.map((m, i) => [xs(i), ys(mockStats(m).score)]);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const dots = list.map((m, i) => { const st = mockStats(m); return `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="4.5" fill="var(--seal)"><title>${esc(m.name)}: ${st.score}점</title></circle><text x="${pts[i][0]}" y="${pts[i][1] - 9}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink)">${st.score}</text><text x="${pts[i][0]}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--ink-2)">${m.mockNo || i + 1}회</text>`; }).join('');
    $('#mockChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="모의고사 회차별 점수">${g}<path d="${path}" fill="none" stroke="var(--seal)" stroke-width="2"/>${dots}</svg>`;
  }
  function renderMock() {
    renderMockSetup();
    const list = mocks();
    renderMockChart(list);
    if (!list.length) { $('#mockTable').innerHTML = ''; $('#mockTrackSub').textContent = '회차별 점수(100점 환산)와 세목별 정답률이에요.'; return; }
    const subs = SUBJ_ORDER.filter((sj) => list.some((m) => mockStats(m).by[sj]));
    let prev = null;
    const rows = list.map((m) => {
      const st = mockStats(m);
      const diff = prev == null ? '' : st.score > prev ? `<span class="up">▲${Math.round((st.score - prev) * 10) / 10}</span>` : st.score < prev ? `<span class="down">▼${Math.round((prev - st.score) * 10) / 10}</span>` : '';
      prev = st.score;
      const cells = subs.map((sj) => { const b = st.by[sj]; return `<td>${b ? `${b[0]}/${b[1]}` : '-'}</td>`; }).join('');
      const wrong = st.total - st.right;
      return `<tr><td class="name">${esc(m.name)}</td><td>${fmtShort(m.startedAt)}</td><td class="score">${st.score}${diff}</td><td>${st.right}/${st.total}${st.done < st.total ? ` <span style="color:var(--muted)">(미제출 ${st.total - st.done})</span>` : ''}</td>${cells}<td><button data-mock-retry="${esc(m.id)}"${wrong ? '' : ' disabled'}>오답 ${wrong}</button></td></tr>`;
    }).join('');
    const tot = {}; list.forEach((m) => { const st = mockStats(m); subs.forEach((sj) => { const b = st.by[sj]; if (b) { tot[sj] = tot[sj] || [0, 0]; tot[sj][0] += b[0]; tot[sj][1] += b[1]; } }); });
    const avgScore = Math.round(list.reduce((a, m) => a + mockStats(m).score, 0) / list.length * 10) / 10;
    const avgRow = `<tr class="avg"><td class="name">평균 · 누적</td><td></td><td class="score">${avgScore}</td><td></td>${subs.map((sj) => `<td>${Math.round(tot[sj][0] / tot[sj][1] * 100)}%</td>`).join('')}<td></td></tr>`;
    $('#mockTable').innerHTML = `<table class="mock-table"><tr><th>회차</th><th>응시</th><th>점수</th><th>정답</th>${subs.map((sj) => `<th>${SUBJ[sj]}</th>`).join('')}<th>다시 풀기</th></tr>${rows}${avgRow}</table>`;
    const first = mockStats(list[0]).score; const last = mockStats(list[list.length - 1]).score;
    $('#mockTrackSub').textContent = list.length > 1 ? `${list.length}회 응시 · 첫 회 ${first}점 → 최근 ${last}점 (${last >= first ? '+' : ''}${Math.round((last - first) * 10) / 10}점)` : '회차별 점수(100점 환산)와 세목별 정답률이에요. 안 푼 문제는 틀린 것으로 계산해요.';
  }
  $('#mockTable').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mock-retry]'); if (!b) return;
    const m = state.sessions.find((x) => x.id === b.dataset.mockRetry); if (!m) return;
    const got = new Map(m.entries.map((x) => [x.id, x.correct]));
    startQuiz(m.queue.filter((id) => !got.get(id)).map((id) => byId.get(id)).filter(Boolean), `${m.name.slice(0, 12)} 오답 다시`);
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
    if (i >= 0) { state.ox.splice(i, 1); saveOxDel(key); toast('OX 장부에서 뺐어요'); }
    else { const o = { key, ...statementFor(key), addedAt: Date.now() }; state.ox.push(o); saveOxAdd(o); toast('OX 장부에 담았어요'); }
    updateCounts();
  }
  const GANA_REV = Object.fromEntries(Object.entries(GANA).map(([k, v]) => [v, k]));
  function labelShow(l) { return /^\d$/.test(l) ? CIRC[Number(l) - 1] : (GANA_REV[l] || l); }
  function labelText(o) { return labelShow(o.label); }
  function renderOxList() {
    $('#oxStartBtn').disabled = !state.ox.length;
    updateStarBtn();
    $('#oxList').innerHTML = state.ox.length ? state.ox.map((o) => {
      const q = byId.get(o.id);
      return `<li${o.starred ? ' class="starred"' : ''}><span class="src">${q.year}-${String(q.no).padStart(2, '0')} ${labelText(o)}<br>${q.subject}</span><span class="t">${esc(statementFor(o.key).text)}</span><button class="star${o.starred ? ' on' : ''}" data-star="${esc(o.key)}" aria-label="${o.starred ? '별표 빼기' : '별표 달기'}" title="${o.starred ? '별표 빼기' : '별표 달기'}">${o.starred ? '★' : '☆'}</button><button class="del" data-del="${esc(o.key)}" aria-label="삭제">×</button></li>`;
    }).join('') : '<li class="empty">아직 담은 지문이 없어요. 문제 풀이 중 선지 옆 ⊕ 버튼을 눌러 보세요.</li>';
  }
  // ---------- 별표 ----------
  function starStoreKey() { return state.user ? 'oxStars_' + state.user.id : 'oxStarsLocal'; }
  function starCount() { return state.ox.filter((o) => o.starred).length; }
  function updateStarBtn() {
    const b = $('#oxStarViewBtn'); if (!b) return;
    const n = starCount(); b.disabled = !n; $('#oxStarCount').textContent = n;
  }
  function toggleStar(key) {
    const o = state.ox.find((x) => x.key === key); if (!o) return;
    o.starred = !o.starred;
    if (!state.user) LS.set('oxBank', state.ox);
    else if (state.starCol) cloud.setStar(key, o.starred).catch(() => toast('별표를 계정에 저장하지 못했어요'));
    else LS.set(starStoreKey(), state.ox.filter((x) => x.starred).map((x) => x.key));
    toast(o.starred ? '별표를 달았어요' : '별표를 뺐어요');
  }
  function renderStarCards() {
    const list = state.ox.filter((o) => o.starred);
    $('#starSub').textContent = list.length ? `별표한 지문 ${list.length}개 · 카드를 누르면 뒤집혀 답이 나와요.` : '별표한 지문이 없어요. OX 장부에서 ☆를 눌러 별표를 달아 보세요.';
    $('#starGrid').innerHTML = list.map((o) => {
      const q = byId.get(o.id); const st = statementFor(o.key);
      const ek = /^\d$/.test(st.label) ? st.label : (GANA_REV[st.label] || st.label);
      const ex = q.expl && q.expl[ek];
      const src = `${SUBJ[q.subject]} · ${q.year}년 ${q.no}번 ${labelShow(st.label)}`;
      return `<div class="flip" data-flip tabindex="0" role="button" aria-label="카드 뒤집기"><div class="flip-in">`
        + `<div class="face front"><div class="fc-src">${src}</div><div class="fc-text">${esc(st.text)}</div><div class="fc-hint">눌러서 답 보기</div></div>`
        + `<div class="face back ${st.ok ? 'is-o' : 'is-x'}"><div class="fc-src">${src}</div><div class="fc-ans"><span class="ox-mark">${st.ok ? OX_SVG.o : OX_SVG.x}</span>${st.ok ? '맞는 지문' : '틀린 지문'}</div>${ex ? `<div class="fc-expl">${esc(ex)}</div>` : ''}<div class="fc-hint">눌러서 앞면 보기</div></div>`
        + `</div></div>`;
    }).join('');
  }
  $('#starGrid').addEventListener('click', (e) => { const f = e.target.closest('[data-flip]'); if (f) f.classList.toggle('flipped'); });
  $('#starGrid').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-flip]')) { e.preventDefault(); e.target.classList.toggle('flipped'); } });
  $('#starFlipAll').addEventListener('click', () => {
    const cards = $$('#starGrid .flip'); const anyFront = cards.some((c) => !c.classList.contains('flipped'));
    cards.forEach((c) => c.classList.toggle('flipped', anyFront));
  });
  $('#starShuffle').addEventListener('click', () => {
    const g = $('#starGrid'); shuffle([...g.children]).forEach((c) => { c.classList.remove('flipped'); g.appendChild(c); });
  });
  $('#oxList').addEventListener('click', (e) => {
    const sbtn = e.target.closest('[data-star]');
    if (sbtn) { toggleStar(sbtn.dataset.star); renderOxList(); return; }
    const d = e.target.closest('[data-del]'); if (!d) return;
    state.ox = state.ox.filter((o) => o.key !== d.dataset.del); saveOxDel(d.dataset.del); updateCounts(); renderOxList();
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
  const OX_SVG = {
    o: '<svg class="oxi" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="13"/></svg>',
    x: '<svg class="oxi" viewBox="0 0 100 100" aria-hidden="true"><path d="M22 22 L78 78 M78 22 L22 78" fill="none" stroke="currentColor" stroke-width="13" stroke-linecap="round"/></svg>',
  };
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
      `<div class="q-meta"><span class="tag subj">${SUBJ[q.subject]}</span><span class="tag">${q.year}년 ${q.no}번 ${labelText(o)}</span><button class="ask-btn" data-ox-ask="${esc(o.key)}">질문하기</button></div>` +
      `<div class="q-stem">${esc(statementFor(key).text)}</div>` +
      `<div class="ox-ctx">원문 발문: ${esc(o.stem)}</div>` +
      `<div class="ox-btns"><button class="ox-btn o${answered && picked === true ? ' picked' : ''}" data-ox="1" aria-label="O (맞는 지문)" ${answered ? 'disabled' : ''}>${OX_SVG.o}</button><button class="ox-btn x${answered && picked === false ? ' picked' : ''}" data-ox="0" aria-label="X (틀린 지문)" ${answered ? 'disabled' : ''}>${OX_SVG.x}</button></div>` +
      (answered ? `<div class="ox-result" style="color:var(${correct ? '--ok' : '--seal'})">${correct ? '정답' : '오답'} · 이 지문은 <b>${o.ok ? 'O (맞는 지문)' : 'X (틀린 지문)'}</b>이에요.</div>${explHtml(q, /^\d$/.test(o.label) ? o.label : (GANA_REV[o.label] || o.label))}<div class="stamp show ${correct ? 'ok' : 'no'}">${correct ? '정답' : '오답'}</div>` : '');
    $('#oxNextBtn').hidden = !answered;
  }
  $('#oxCard').addEventListener('click', (e) => {
    const ak = e.target.closest('[data-ox-ask]');
    if (ak) { const st = state.ox.find((x) => x.key === ak.dataset.oxAsk) || statementFor(ak.dataset.oxAsk); openAsk({ qid: st.id, label: st.label, kind: 'option' }); return; }
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
    if ($('#sessCount')) $('#sessCount').textContent = state.sessions.length;
    $('#acctHist').textContent = state.history.length;
    $('#acctOx').textContent = state.ox.length;
    updateInqPill();
  }

  // ---------- account (Supabase Auth) ----------
  const CFG = window.SUPABASE_CONFIG || {};
  let sb = null;
  try {
    if (window.supabase && CFG.url && CFG.key) {
      sb = window.supabase.createClient(CFG.url, CFG.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
      });
    }
  } catch { sb = null; }
  const siteUrl = () => location.origin + location.pathname;

  const cloud = {
    async loadHistory() {
      const out = []; const size = 1000;
      for (let from = 0; ; from += size) {
        const { data, error } = await sb.from('quiz_history').select('question_id,pick,correct,answered_at')
          .order('answered_at', { ascending: true }).order('id', { ascending: true }).range(from, from + size - 1);
        if (error) throw error;
        data.forEach((r) => out.push({ id: r.question_id, pick: r.pick, correct: r.correct, at: Date.parse(r.answered_at) }));
        if (data.length < size) break;
      }
      return out;
    },
    async loadOx() {
      let { data, error } = await sb.from('ox_notes').select('key,added_at,starred').order('added_at', { ascending: true });
      if (error) {
        // starred 열이 아직 없으면(SQL 미실행) 별표는 이 기기에만 저장
        state.starCol = false;
        ({ data, error } = await sb.from('ox_notes').select('key,added_at').order('added_at', { ascending: true }));
        if (error) throw error;
      } else state.starCol = true;
      return data.map((r) => ({ key: r.key, at: Date.parse(r.added_at), starred: !!r.starred }));
    },
    async setStar(key, on) {
      const { error } = await sb.from('ox_notes').update({ starred: on }).eq('user_id', state.user.id).eq('key', key);
      if (error) throw error;
    },
    async addHistory(list) {
      if (!list.length) return;
      const rows = list.map((h) => ({ user_id: state.user.id, question_id: h.id, pick: h.pick, correct: h.correct, answered_at: new Date(h.at).toISOString() }));
      const { error } = await sb.from('quiz_history').insert(rows);
      if (error) throw error;
    },
    async clearHistory() {
      const { error } = await sb.from('quiz_history').delete().eq('user_id', state.user.id);
      if (error) throw error;
    },
    async addOx(list) {
      if (!list.length) return;
      const rows = list.map((o) => {
        const r = { user_id: state.user.id, key: o.key, added_at: new Date(o.addedAt || Date.now()).toISOString() };
        if (state.starCol && o.starred) r.starred = true;
        return r;
      });
      const { error } = await sb.from('ox_notes').upsert(rows, { onConflict: 'user_id,key', ignoreDuplicates: true });
      if (error) throw error;
    },
    async delOx(key) {
      const { error } = await sb.from('ox_notes').delete().eq('user_id', state.user.id).eq('key', key);
      if (error) throw error;
    },
    async loadSessions() {
      const { data, error } = await sb.from('quiz_sessions').select('id,name,started_at,ended_at,queue,entries,kind,mock_no,template_year').order('started_at', { ascending: false });
      if (error) throw error;
      return data.map((r) => ({ id: r.id, name: r.name, startedAt: Date.parse(r.started_at), endedAt: Date.parse(r.ended_at), queue: r.queue || [], entries: r.entries || [], kind: r.kind || 'normal', mockNo: r.mock_no, templateYear: r.template_year }));
    },
    async addSession(ss) {
      const row = { user_id: state.user.id, name: ss.name, started_at: new Date(ss.startedAt).toISOString(), ended_at: new Date(ss.endedAt).toISOString(), queue: ss.queue, entries: ss.entries, kind: ss.kind || 'normal', mock_no: ss.mockNo || null, template_year: ss.templateYear || null };
      const { data, error } = await sb.from('quiz_sessions').insert(row).select('id').single();
      if (error) throw error;
      return data;
    },
    async updateSession(id, patch) {
      const { error } = await sb.from('quiz_sessions').update(patch).eq('id', id).eq('user_id', state.user.id);
      if (error) throw error;
    },
    async delSession(id) {
      const { error } = await sb.from('quiz_sessions').delete().eq('id', id).eq('user_id', state.user.id);
      if (error) throw error;
    },
  };

  function oxFromKey(key, at) {
    const m = String(key).match(/^(\d{4}-\d{2})-/);
    if (!m || !byId.has(m[1])) return null;
    try { return { key, ...statementFor(key), addedAt: at }; } catch { return null; }
  }

  async function enterAccount(user) {
    state.user = user;
    renderAuth();
    try {
      // 로그인 전 이 기기에 쌓인 기록을 계정으로 옮김 (옮긴 뒤 로컬 사본은 비움)
      const localHist = SS.get('history', []).filter((h) => byId.has(h.id));
      const localOx = LS.get('oxBank', []).filter((o) => byId.has(o.id));
      if (localHist.length) { await cloud.addHistory(localHist); SS.set('history', []); }
      if (localOx.length) { await cloud.addOx(localOx); LS.set('oxBank', []); }
      const [hist, ox] = await Promise.all([cloud.loadHistory(), cloud.loadOx()]);
      if (!state.user || state.user.id !== user.id) return;
      state.history = hist.filter((h) => byId.has(h.id));
      const localStars = new Set(LS.get(starStoreKey(), []));
      state.ox = ox.map((r) => { const o = oxFromKey(r.key, r.at); if (o) o.starred = state.starCol ? r.starred : localStars.has(r.key); return o; }).filter(Boolean);
      const moved = localHist.length + localOx.length;
      toast(moved ? `이 기기의 기록 ${moved}건을 계정으로 옮겼어요` : '계정 기록을 불러왔어요');
      checkAdmin(user);
    } catch (err) {
      console.error(err);
      toast('계정 기록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.');
    }
    try {
      // 저장한 세션도 계정으로 옮김 (quiz_sessions 테이블이 없으면 이 부분만 건너뜀)
      const localSess = LS.get('quizSessions', []);
      for (const ss of localSess) {
        const row = await cloud.addSession(ss);
        if (state.run && state.run.savedId === ss.id) state.run.savedId = row.id;
      }
      if (localSess.length) LS.set('quizSessions', []);
      const sess = await cloud.loadSessions();
      if (state.user && state.user.id === user.id) state.sessions = sess;
    } catch (err) {
      console.error(err);
      toast('저장한 세션을 계정에서 불러오지 못했어요');
    }
    refreshAll();
  }
  function leaveAccount() {
    state.user = null; state.isAdmin = false;
    state.history = SS.get('history', []);
    state.ox = LS.get('oxBank', []).filter((o) => byId.has(o.id));
    state.sessions = LS.get('quizSessions', []);
    if (state.run) state.run.savedId = null;
    renderAuth(); refreshAll();
  }
  function refreshAll() {
    updateCounts();
    if (!$('#view-ox').hidden) renderOxList();
    if ($('#drawer').classList.contains('open')) { renderHistory(); renderSessions(); }
    if (!$('#view-mock').hidden) renderMock();
    if (!$('#view-inbox').hidden) renderBoard();
  }

  function renderAuth() {
    const u = state.user;
    $('#authBtn').classList.toggle('in', !!u);
    $('#authBtnText').textContent = u ? (u.email || '내 계정') : '로그인';
    $('#authBtn').title = u ? '계정: ' + (u.email || '') : '로그인';
    $('#histTitle').textContent = u ? '내 풀이 기록' : '이번 세션 히스토리';
    $('#oxWhere').textContent = u
      ? '선지 옆 ⊕ 버튼으로 담아 둔 지문이에요. 계정에 저장돼 다른 기기에서도 보여요.'
      : '선지 옆 ⊕ 버튼으로 담아 둔 지문이에요. 이 브라우저에 저장됩니다. 로그인하면 계정에 저장돼요.';
    $('#authOut').hidden = !!u || authView === 'reset';
    $('#authReset').hidden = authView !== 'reset';
    $('#authIn').hidden = !u || authView === 'reset';
    $('#authTitle').textContent = authView === 'reset' ? '비밀번호 재설정' : u ? '내 계정' : '로그인';
    $('#authSub').hidden = !!u;
    $('#authEmailShow').textContent = u ? (u.email || '(이메일 없음)') : '';
  }

  let authView = 'main'; // main | reset
  let authMode = 'signin'; // signin | signup | magic
  const MODE = {
    signin: { btn: '로그인', hint: '', pw: true, ac: 'current-password' },
    signup: { btn: '회원가입', hint: '가입하면 인증 메일이 와요. 메일의 링크를 눌러야 로그인할 수 있어요.', pw: true, ac: 'new-password' },
    magic: { btn: '로그인 링크 받기', hint: '비밀번호 없이, 메일로 온 링크를 누르면 바로 로그인돼요. 처음이면 자동으로 가입돼요.', pw: false },
  };
  function setMode(m) {
    authMode = m;
    $$('#authModeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    const c = MODE[m];
    $('#authSubmit').textContent = c.btn;
    $('#authModeHint').textContent = c.hint; $('#authModeHint').hidden = !c.hint;
    $('#pwField').hidden = !c.pw;
    if (c.ac) $('#authPw').setAttribute('autocomplete', c.ac);
    $('#forgotBtn').hidden = m !== 'signin';
    msg('');
  }
  function msg(text, kind) {
    const el = $('#authMsg'); el.textContent = text || ''; el.className = 'auth-msg' + (kind ? ' ' + kind : '');
  }
  function errText(err) {
    const code = err && (err.code || ''); const m = (err && err.message) || '';
    if (code === 'invalid_credentials' || /Invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않아요.';
    if (code === 'email_not_confirmed' || /not confirmed/i.test(m)) return '이메일 인증을 먼저 마쳐 주세요. 받은 메일의 링크를 눌러 주세요.';
    if (code === 'user_already_exists' || /already registered/i.test(m)) return '이미 가입된 이메일이에요. 로그인해 주세요.';
    if (code === 'weak_password' || /password/i.test(m) && /least|short|weak/i.test(m)) return '비밀번호를 더 길고 복잡하게 정해 주세요. (6자 이상)';
    if (/rate limit|too many|over_email_send_rate_limit/i.test(code + m)) return '요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.';
    if (/provider is not enabled|Unsupported provider/i.test(m)) return '이 로그인 방식이 아직 켜져 있지 않아요.';
    if (/fetch|network/i.test(m)) return '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';
    return '문제가 생겼어요: ' + m;
  }
  function openAuth() {
    if (!sb) { toast('로그인 기능을 불러오지 못했어요. 새로고침해 주세요.'); return; }
    renderAuth(); msg('');
    $('#authModal').hidden = false;
    if (!state.user && authView === 'main') setTimeout(() => $('#authEmail').focus(), 30);
  }
  function closeAuth() { $('#authModal').hidden = true; if (authView === 'reset') { authView = 'main'; renderAuth(); } }
  $('#authBtn').addEventListener('click', openAuth);
  $('#authClose').addEventListener('click', closeAuth);
  $('#authModal').addEventListener('click', (e) => { if (e.target.id === 'authModal') closeAuth(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#authModal').hidden) closeAuth(); });
  $('#authModeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });

  async function busy(btn, fn) {
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  }
  $('#authForm').addEventListener('submit', (e) => {
    e.preventDefault();
    let email = $('#authEmail').value.trim(); const pw = $('#authPw').value;
    // 관리자 로그인: 이메일 칸에 아이디(admin)를 적으면 관리자 이메일로 바꿔 로그인
    const ADMIN_ID = (CFG.admin && CFG.admin.id) || 'admin';
    if (authMode === 'signin' && CFG.admin && CFG.admin.email && email.toLowerCase() === ADMIN_ID.toLowerCase()) email = CFG.admin.email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg('이메일 주소를 확인해 주세요.', 'err'); return; }
    if (MODE[authMode].pw && pw.length < 6) { msg('비밀번호는 6자 이상이어야 해요.', 'err'); return; }
    busy($('#authSubmit'), async () => {
      msg('처리 중…');
      if (authMode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password: pw });
        if (error) return msg(errText(error), 'err');
        msg(''); closeAuth();
      } else if (authMode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: siteUrl() } });
        if (error) return msg(errText(error), 'err');
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return msg('이미 가입된 이메일이에요. 로그인해 주세요.', 'err');
        if (data.session) { msg(''); closeAuth(); return; }
        msg(`${email} 로 인증 메일을 보냈어요. 메일의 링크를 누르면 로그인돼요.`, 'ok');
      } else {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: siteUrl(), shouldCreateUser: true } });
        if (error) return msg(errText(error), 'err');
        msg(`${email} 로 로그인 링크를 보냈어요. 이 기기에서 메일을 열고 링크를 눌러 주세요.`, 'ok');
      }
    }).catch((err) => msg(errText(err), 'err'));
  });
  $('#forgotBtn').addEventListener('click', () => {
    const email = $('#authEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg('위에 이메일을 먼저 입력해 주세요.', 'err'); $('#authEmail').focus(); return; }
    busy($('#forgotBtn'), async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() });
      if (error) return msg(errText(error), 'err');
      msg(`${email} 로 비밀번호 재설정 메일을 보냈어요.`, 'ok');
    }).catch((err) => msg(errText(err), 'err'));
  });
  $('#authReset').addEventListener('submit', (e) => {
    e.preventDefault();
    const pw = $('#resetPw').value;
    if (pw.length < 6) { msg('비밀번호는 6자 이상이어야 해요.', 'err'); return; }
    busy($('#authReset button'), async () => {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) return msg(errText(error), 'err');
      authView = 'main'; $('#resetPw').value = ''; renderAuth();
      msg('비밀번호를 바꿨어요.', 'ok');
    }).catch((err) => msg(errText(err), 'err'));
  });
  $('#oauthBox').addEventListener('click', (e) => {
    const b = e.target.closest('[data-provider]'); if (!b) return;
    busy(b, async () => {
      msg('이동 중…');
      const { error } = await sb.auth.signInWithOAuth({ provider: b.dataset.provider, options: { redirectTo: siteUrl() } });
      if (error) msg(errText(error), 'err');
    }).catch((err) => msg(errText(err), 'err'));
  });
  $('#signOutBtn').addEventListener('click', () => {
    busy($('#signOutBtn'), async () => {
      await sb.auth.signOut();
      closeAuth(); toast('로그아웃했어요');
    }).catch(() => toast('로그아웃하지 못했어요'));
  });

  function initAuth() {
    const prov = CFG.providers || {};
    let anyProv = false;
    $$('#oauthBox [data-provider]').forEach((b) => { const on = !!prov[b.dataset.provider]; b.hidden = !on; anyProv = anyProv || on; });
    $('#oauthBox').hidden = !anyProv;
    setMode('signin'); renderAuth();
    // 메일 링크가 만료되었을 때 등 주소에 붙어 오는 오류 표시
    const hp = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
    if (hp.get('error_description')) {
      const code = hp.get('error_code') || '';
      toast(code === 'otp_expired' ? '링크가 만료됐어요. 다시 요청해 주세요.' : '로그인 오류: ' + hp.get('error_description'));
      history.replaceState(null, '', location.pathname);
    }
    if (!sb) return;
    sb.auth.onAuthStateChange((event, session) => {
      const user = session && session.user;
      // 콜백 안에서 바로 Supabase를 다시 호출하면 멈출 수 있어 다음 틱으로 미룸
      setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY') { authView = 'reset'; renderAuth(); openAuth(); }
        if (user && (!state.user || state.user.id !== user.id)) { enterAccount(user); }
        else if (user) { state.user = user; renderAuth(); }
        else if (!user && state.user) leaveAccount();
      }, 0);
    });
  }

  // ---------- 질문게시판 ----------
  // inquiries 테이블: 누구나 읽기, 로그인한 사람만 쓰기, 관리자(admins 테이블)만 답변
  state.inq = []; state.isAdmin = false; state.inqLoaded = false;
  const KIND = { problem: '문제 질문', option: '선지 질문', suggestion: '건의사항' };
  const board = { tab: 'all' };
  const fmtTime = (t) => { const d = new Date(t); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  function inqCountFor(qid, label) {
    return state.inq.filter((r) => r.question_id === qid && (label == null || r.option_label === label)).length;
  }
  function askMeta(qid) {
    const n = inqCountFor(qid);
    return (n ? `<button class="q-asks" data-board-q="${esc(qid)}">질문 ${n}</button>` : '') + '<button class="ask-btn" data-ask>질문하기</button>';
  }
  function optQ(qid, label) {
    const n = inqCountFor(qid, label);
    return n ? `<button type="button" class="opt-q" data-board-opt="${esc(label)}" title="이 선지에 달린 질문 ${n}개 보기">질문 ${n}</button>` : '';
  }
  function inMockRun() { return !!(state.run && state.run.mock); }
  function optChoices(q) {
    if (q.type === '가나다') return q.items.map((it) => ({ value: GANA[it.label] || it.label, text: it.text }));
    return q.options.map((t, i) => ({ value: String(i + 1), text: t }));
  }
  function targetText(r) {
    const q = byId.get(r.question_id);
    if (!q) return '';
    return `${q.year}년 ${q.no}번 · ${SUBJ[q.subject]}` + (r.option_label ? ` · ${labelShow(r.option_label)}` : '');
  }
  function quoteFor(r) {
    const q = byId.get(r.question_id); if (!q) return '';
    if (r.option_label) { try { return statementFor(`${q.id}-${r.option_label}`).text; } catch { return ''; } }
    return q.stem;
  }

  async function loadInquiries() {
    if (!sb) return;
    try {
      const out = []; const size = 1000;
      for (let from = 0; ; from += size) {
        const { data, error } = await sb.from('inquiries')
          .select('id,user_id,author,kind,question_id,option_label,body,created_at,answer,answered_at')
          .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + size - 1);
        if (error) throw error;
        out.push(...data);
        if (data.length < size) break;
      }
      state.inq = out; state.inqLoaded = true;
    } catch (err) { console.error(err); state.inqError = true; }
    updateInqPill();
    if (!$('#view-inbox').hidden) renderBoard();
    if (!$('#view-quiz').hidden && state.queue.length) renderQ();
  }
  async function checkAdmin(user) {
    try {
      const { data, error } = await sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
      state.isAdmin = !error && !!data;
    } catch { state.isAdmin = false; }
    updateInqPill(); if (!$('#view-inbox').hidden) renderBoard();
  }
  const seenKey = () => 'inqSeen:' + (state.user ? state.user.id : '');
  function updateInqPill() {
    const pill = $('#inqCount'); if (!pill) return;
    let n = 0; let title = '';
    if (state.user && state.isAdmin) { n = state.inq.filter((r) => !r.answer).length; title = '답변을 기다리는 질문'; }
    else if (state.user) {
      const seen = LS.get(seenKey(), 0);
      n = state.inq.filter((r) => r.user_id === state.user.id && r.answered_at && Date.parse(r.answered_at) > seen).length;
      title = '새 답변';
    }
    pill.textContent = n; pill.hidden = !n; pill.title = title;
  }

  // 필터
  function fillYearNo() {
    const years = [...new Set(Q.map((q) => q.year))].sort((a, b) => b - a);
    $('#fYear').innerHTML = '<option value="">모든 연도</option>' + years.map((y) => `<option value="${y}">${y}년</option>`).join('');
    fillNo();
  }
  function fillNo() {
    const y = Number($('#fYear').value);
    const nos = [...new Set(Q.filter((q) => !y || q.year === y).map((q) => q.no))].sort((a, b) => a - b);
    const cur = $('#fNo').value;
    $('#fNo').innerHTML = '<option value="">모든 문항</option>' + nos.map((n) => `<option value="${n}">${n}번</option>`).join('');
    if (nos.includes(Number(cur))) $('#fNo').value = cur;
    fillOpt();
  }
  function selectedQ() {
    const y = Number($('#fYear').value); const n = Number($('#fNo').value);
    return y && n ? Q.find((q) => q.year === y && q.no === n) : null;
  }
  function fillOpt() {
    const q = selectedQ();
    const cur = $('#fOpt').value;
    $('#fOpt').disabled = !q;
    $('#fOpt').innerHTML = '<option value="">모든 선지</option>' + (q ? optChoices(q).map((c) => `<option value="${esc(c.value)}">${labelShow(c.value)} ${esc(c.text.slice(0, 24))}…</option>`).join('') : '');
    if (q && optChoices(q).some((c) => c.value === cur)) $('#fOpt').value = cur;
  }
  function openBoard({ qid, label } = {}) {
    const q = qid && byId.get(qid);
    board.tab = 'all'; $$('#inboxSeg button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'all'));
    $('#fKind').value = ''; $('#fText').value = '';
    $('#fYear').value = q ? String(q.year) : ''; fillNo();
    $('#fNo').value = q ? String(q.no) : ''; fillOpt();
    $('#fOpt').value = label || '';
    show('inbox');
  }

  function filtered() {
    const kind = $('#fKind').value; const y = Number($('#fYear').value); const no = Number($('#fNo').value);
    const opt = $('#fOpt').value; const text = $('#fText').value.trim().toLowerCase();
    return state.inq.filter((r) => {
      if (board.tab === 'open' && r.answer) return false;
      if (board.tab === 'mine' && (!state.user || r.user_id !== state.user.id)) return false;
      if (kind && r.kind !== kind) return false;
      const q = r.question_id ? byId.get(r.question_id) : null;
      if ((y || no) && !q) return false;
      if (y && q.year !== y) return false;
      if (no && q.no !== no) return false;
      if (opt && r.option_label !== opt) return false;
      if (text) {
        const hay = [r.body, r.answer, quoteFor(r), targetText(r)].join(' ').toLowerCase();
        if (!text.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }
  function renderBoard() {
    const list = filtered();
    const me = state.user && state.user.id;
    if (board.tab === 'mine' && me) LS.set(seenKey(), Date.now());
    let hint;
    if (!sb) hint = '게시판을 불러오지 못했어요. 새로고침해 주세요.';
    else if (state.inqError && !state.inqLoaded) hint = '게시판을 불러오지 못했어요. 잠시 후 다시 열어 주세요.';
    else if (!state.inqLoaded) hint = '불러오는 중…';
    else hint = `${list.length}개의 글` + (state.isAdmin ? ' · 관리자 모드: 글마다 답변을 달 수 있어요.' : ' · 문제 풀이 화면의 <b>질문하기</b>로 문제나 선지에 대해 물어볼 수 있어요.');
    $('#inboxHint').innerHTML = hint;
    if (board.tab === 'mine' && !me) {
      $('#inqList').innerHTML = '<li class="empty">로그인하면 내가 남긴 질문과 답변을 모아 볼 수 있어요.<br><button class="btn" data-login style="margin-top:10px">로그인</button></li>';
      updateInqPill(); return;
    }
    $('#inqList').innerHTML = list.length ? list.map((r) => {
      const mine = me && r.user_id === me;
      const tgt = targetText(r); const quote = quoteFor(r);
      const isNew = mine && !state.isAdmin && r.answered_at && Date.parse(r.answered_at) > LS.get(seenKey(), 0);
      return `<li data-inq="${r.id}">
        <div class="inq-head"><span class="tag${r.kind === 'suggestion' ? '' : ' subj'}">${KIND[r.kind] || r.kind}</span>${tgt ? `<button class="inq-target" data-jump-q="${esc(r.question_id)}" title="이 문제 풀어 보기">${esc(tgt)}</button>` : ''}${isNew ? '<span class="inq-new">새 답변</span>' : ''}<span class="who">${esc(r.author || '회원')}${mine ? ' (나)' : ''}</span><span class="when">${fmtTime(r.created_at)}</span></div>
        ${quote ? `<div class="inq-quote">${esc(quote)}</div>` : ''}
        <div class="inq-body">${esc(r.body)}</div>
        ${r.answer ? `<div class="inq-ans"><b>연신내기린아 답변 · ${fmtTime(r.answered_at)}</b>${esc(r.answer)}</div>` : '<div class="inq-wait">답변 대기 중</div>'}
        ${state.isAdmin ? (r.answer ? '<div class="inq-actions"><button data-reply-open>답변 수정</button><button data-reply-clear>답변 지우기</button><button data-inq-del>글 삭제</button></div>' : '')
          + `<div class="inq-reply"${r.answer ? ' hidden' : ''}><textarea data-reply-text placeholder="답변을 적어 주세요">${esc(r.answer || '')}</textarea><div class="inq-actions"><button class="btn primary" data-reply-save>${r.answer ? '수정 저장' : '답변 달기'}</button>${r.answer ? '' : '<button data-inq-del>글 삭제</button>'}</div></div>`
          : (mine && !r.answer ? '<div class="inq-actions"><button data-inq-del>삭제</button></div>' : '')}
      </li>`;
    }).join('') : `<li class="empty">${state.inq.length ? '조건에 맞는 글이 없어요.' : '아직 올라온 질문이 없어요.'}</li>`;
    updateInqPill();
  }

  function initBoard() {
    fillYearNo();
    $('#inboxSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      board.tab = b.dataset.tab; $$('#inboxSeg button').forEach((x) => x.classList.toggle('on', x === b)); renderBoard();
    });
    $('#fYear').addEventListener('change', () => { fillNo(); renderBoard(); });
    $('#fNo').addEventListener('change', () => { fillOpt(); renderBoard(); });
    $('#fOpt').addEventListener('change', renderBoard);
    $('#fKind').addEventListener('change', renderBoard);
    $('#fText').addEventListener('input', () => { clearTimeout(initBoard._t); initBoard._t = setTimeout(renderBoard, 150); });
    $('#fReset').addEventListener('click', () => openBoard());
    $('#suggestBtn').addEventListener('click', () => {
      const q = selectedQ(); const opt = $('#fOpt').value;
      openAsk({ qid: q ? q.id : null, label: opt || null, kind: q ? (opt ? 'option' : 'problem') : 'suggestion', pick: true });
    });
    $('#askYear').addEventListener('change', () => { fillAskNo(); pickAskQ(); });
    $('#askNo').addEventListener('change', pickAskQ);
    $('#qlistClose').addEventListener('click', closeQList);
    $('#qlistModal').addEventListener('click', (e) => { if (e.target.id === 'qlistModal') closeQList(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#qlistModal').hidden) closeQList(); });
    $('#qlistAsk').addEventListener('click', () => { const { qid, label } = qlist; closeQList(); openAsk({ qid, label, kind: label ? 'option' : 'problem' }); });
    $('#qlistBoard').addEventListener('click', () => { const { qid, label } = qlist; closeQList(); openBoard({ qid, label }); });
    $('#inqList').addEventListener('click', async (e) => {
      if (e.target.closest('[data-login]')) { openAuth(); return; }
      const j = e.target.closest('[data-jump-q]');
      if (j) { const q = byId.get(j.dataset.jumpQ); if (q) startQuiz([q]); return; }
      const li = e.target.closest('[data-inq]'); if (!li) return;
      const id = Number(li.dataset.inq); const r = state.inq.find((x) => x.id === id); if (!r) return;
      const btn = e.target.closest('button'); if (!btn) return;
      if (btn.matches('[data-reply-open]')) { const box = li.querySelector('.inq-reply'); box.hidden = !box.hidden; if (!box.hidden) box.querySelector('textarea').focus(); return; }
      if (btn.matches('[data-inq-del]')) {
        if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = '한 번 더 누르면 삭제'; setTimeout(() => { delete btn.dataset.armed; btn.textContent = state.isAdmin ? '글 삭제' : '삭제'; }, 3000); return; }
        btn.disabled = true;
        const { error } = await sb.from('inquiries').delete().eq('id', id);
        if (error) { btn.disabled = false; toast('삭제하지 못했어요'); return; }
        state.inq = state.inq.filter((x) => x.id !== id); toast('삭제했어요'); renderBoard(); return;
      }
      if (btn.matches('[data-reply-save]') || btn.matches('[data-reply-clear]')) {
        const clear = btn.matches('[data-reply-clear]');
        const text = clear ? '' : li.querySelector('[data-reply-text]').value.trim();
        if (!clear && !text) { toast('답변 내용을 적어 주세요'); return; }
        btn.disabled = true;
        const patch = text ? { answer: text, answered_at: new Date().toISOString() } : { answer: null, answered_at: null };
        const { error } = await sb.from('inquiries').update(patch).eq('id', id);
        btn.disabled = false;
        if (error) { toast('답변을 저장하지 못했어요'); console.error(error); return; }
        Object.assign(r, patch); toast(text ? '답변을 저장했어요' : '답변을 지웠어요'); renderBoard();
      }
    });

    // 질문 남기기 창
    $('#askKindSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled) setAskKind(b.dataset.kind); });
    $('#askOpt').addEventListener('change', updateAskQuote);
    $('#askBody').addEventListener('input', () => { $('#askLen').textContent = $('#askBody').value.length; });
    $('#askClose').addEventListener('click', closeAsk);
    $('#askModal').addEventListener('click', (e) => { if (e.target.id === 'askModal') closeAsk(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#askModal').hidden) closeAsk(); });
    $('#askForm').addEventListener('submit', submitAsk);
    loadInquiries();
  }

  const qlist = { qid: null, label: null };
  function openQList(qid, label) {
    const q = byId.get(qid); if (!q) return;
    qlist.qid = qid; qlist.label = label;
    const rows = state.inq.filter((r) => r.question_id === qid && (label == null || r.option_label === label));
    $('#qlistTitle').textContent = label ? `${labelShow(label)} 선지 질문` : '이 문제 질문';
    $('#qlistSub').textContent = `${q.year}년 ${q.no}번 · ${SUBJ[q.subject]} · ${rows.length}개`;
    let quote = q.stem;
    if (label) { try { quote = statementFor(`${qid}-${label}`).text; } catch { /* keep stem */ } }
    $('#qlistQuote').textContent = quote;
    const me = state.user && state.user.id;
    $('#qlistList').innerHTML = rows.length ? rows.map((r) => `<li>
        <div class="inq-head"><span class="tag${r.kind === 'suggestion' ? '' : ' subj'}">${KIND[r.kind] || r.kind}</span>${!label && r.option_label ? `<span class="tag">${labelShow(r.option_label)}</span>` : ''}<span class="who">${esc(r.author || '회원')}${me && r.user_id === me ? ' (나)' : ''}</span><span class="when">${fmtTime(r.created_at)}</span></div>
        <div class="inq-body">${esc(r.body)}</div>
        ${r.answer ? `<div class="inq-ans"><b>연신내기린아 답변 · ${fmtTime(r.answered_at)}</b>${esc(r.answer)}</div>` : '<div class="inq-wait">답변 대기 중</div>'}
      </li>`).join('') : '<li class="empty">아직 질문이 없어요.</li>';
    $('#qlistAsk').textContent = label ? '이 선지에 질문하기' : '이 문제에 질문하기';
    $('#qlistModal').hidden = false;
  }
  function closeQList() { $('#qlistModal').hidden = true; }

  const ask = { qid: null, kind: 'problem' };
  function setAskQ(qid, label) {
    ask.qid = qid;
    const q = qid && byId.get(qid);
    const canPick = !$('#askPick').hidden;
    $$('#askKindSeg button').forEach((b) => { b.disabled = !q && !canPick && b.dataset.kind !== 'suggestion'; });
    $('#askOpt').innerHTML = q ? optChoices(q).map((c) => `<option value="${esc(c.value)}">${labelShow(c.value)} ${esc(c.text.slice(0, 40))}${c.text.length > 40 ? '…' : ''}</option>`).join('') : '';
    if (label) $('#askOpt').value = label;
    return q;
  }
  function fillAskNo() {
    const y = Number($('#askYear').value);
    const nos = y ? Q.filter((x) => x.year === y).map((x) => x.no).sort((a, b) => a - b) : [];
    $('#askNo').innerHTML = '<option value="">문항</option>' + nos.map((n) => `<option value="${n}">${n}번</option>`).join('');
    $('#askNo').disabled = !y;
  }
  function pickAskQ() {
    const y = Number($('#askYear').value); const n = Number($('#askNo').value);
    const q = y && n ? Q.find((x) => x.year === y && x.no === n) : null;
    setAskQ(q ? q.id : null, null);
    setAskKind(q && ask.kind === 'suggestion' ? 'problem' : ask.kind);
  }
  function openAsk({ qid = null, label = null, kind = 'problem', pick = false } = {}) {
    if (!sb) { toast('질문 기능을 불러오지 못했어요. 새로고침해 주세요.'); return; }
    if (!state.user) { toast('질문을 남기려면 먼저 로그인해 주세요'); openAuth(); return; }
    $('#askPick').hidden = !pick;
    const q = setAskQ(qid, label);
    if (pick) {
      const years = [...new Set(Q.map((x) => x.year))].sort((a, b) => b - a);
      $('#askYear').innerHTML = '<option value="">연도 (건의사항은 비워 두기)</option>' + years.map((y) => `<option value="${y}">${y}년</option>`).join('');
      $('#askYear').value = q ? String(q.year) : ''; fillAskNo();
      $('#askNo').value = q ? String(q.no) : '';
    }
    $('#askBody').value = ''; $('#askLen').textContent = '0'; $('#askMsg').textContent = ''; $('#askMsg').className = 'auth-msg';
    setAskKind(q || pick ? kind : 'suggestion');
    $('#askModal').hidden = false;
    setTimeout(() => $('#askBody').focus(), 30);
  }
  function closeAsk() { $('#askModal').hidden = true; }
  function setAskKind(k) {
    ask.kind = k;
    $$('#askKindSeg button').forEach((b) => b.classList.toggle('on', b.dataset.kind === k));
    const q = ask.qid && byId.get(ask.qid);
    $('#askTarget').hidden = k === 'suggestion';
    $('#askTarget').textContent = q ? `${q.year}년 ${q.no}번 · ${SUBJ[q.subject]} · ${q.type === '가나다' ? 'ㄱㄴㄷ' : '오지선다'}` : '위에서 연도와 문항을 골라 주세요.';
    $('#askOptField').hidden = k !== 'option' || !q;
    $('#askYear').options.length && ($('#askYear').options[0].textContent = k === 'suggestion' ? '연도 (건의사항은 비워 두기)' : '연도');
    $('#askBodyLabel').textContent = k === 'suggestion' ? '건의 내용' : '질문 내용';
    $('#askBody').placeholder = k === 'suggestion' ? '사이트에 바라는 점이나 오류를 알려 주세요.' : '헷갈리는 부분이나 근거 조문이 궁금한 점을 적어 주세요.';
    updateAskQuote();
  }
  function updateAskQuote() {
    const q = ask.qid && byId.get(ask.qid);
    let t = '';
    if (q && ask.kind === 'problem') t = q.stem;
    if (q && ask.kind === 'option') { try { t = statementFor(`${q.id}-${$('#askOpt').value}`).text; } catch { t = ''; } }
    $('#askQuote').textContent = t; $('#askQuote').hidden = !t;
  }
  async function submitAsk(e) {
    e.preventDefault();
    const body = $('#askBody').value.trim();
    const m = $('#askMsg');
    if (!body) { m.textContent = '내용을 적어 주세요.'; m.className = 'auth-msg err'; return; }
    if (!state.user) { closeAsk(); openAuth(); return; }
    if (ask.kind !== 'suggestion' && !ask.qid) { m.textContent = '질문할 문제의 연도와 문항을 골라 주세요.'; m.className = 'auth-msg err'; return; }
    const row = { kind: ask.kind, body, question_id: ask.kind === 'suggestion' ? null : ask.qid, option_label: ask.kind === 'option' ? $('#askOpt').value : null };
    $('#askSubmit').disabled = true; m.textContent = '보내는 중…'; m.className = 'auth-msg';
    try {
      const { data, error } = await sb.from('inquiries').insert(row)
        .select('id,user_id,author,kind,question_id,option_label,body,created_at,answer,answered_at').single();
      if (error) throw error;
      state.inq.unshift(data);
      closeAsk(); toast('질문을 남겼어요. 질문게시판에서 답변을 확인할 수 있어요.');
      if (!$('#view-quiz').hidden) renderQ();
      if (!$('#view-inbox').hidden) renderBoard();
    } catch (err) {
      console.error(err);
      m.textContent = '보내지 못했어요. 잠시 후 다시 시도해 주세요.'; m.className = 'auth-msg err';
    } finally { $('#askSubmit').disabled = false; }
  }

  // ---------- boot ----------
  const data = window.QUESTIONS;
  if (!Array.isArray(data)) {
    $('#app').innerHTML = '<p style="text-align:center;padding:40px">문제 데이터(questions.js)를 불러오지 못했어요. index.html과 같은 폴더에 있는지 확인해 주세요.</p>';
  } else {
    Q = data; Q.forEach((q) => byId.set(q.id, q));
    state.ox = state.ox.filter((o) => byId.has(o.id));
    renderHome(); updateCounts(); show('home');
    initAuth();
    initBoard();
  }
})();
