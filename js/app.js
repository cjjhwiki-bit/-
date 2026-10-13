/**
 * 題庫測驗主程式 (app.js)
 * 整合：四層連動選單、按需載入、計時器、手寫計算紙、刪去法、批改與解析
 */

// 全域狀態
let manifestData = [];
let activeQuestions = [];
let currentIndex = 0;

// 作答狀態
let userAnswers = {};
let eliminatedMap = {};
let flaggedSet = new Set();
let timerInterval = null;
let timeSeconds = 0;
let isCountdown = false;

// 頁面初始化
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('manifest.json');
    manifestData = await res.json();
    initHierarchyFilters();
    bindEventHandlers();
    initScratchpad();
  } catch (err) {
    console.error('無法載入 manifest.json:', err);
    alert('題庫目錄 (manifest.json) 讀取失敗，請確認檔案是否存在！');
  }
});

// ================= 1. 四層連動過濾選單 =================
function initHierarchyFilters() {
  const gradeSel = document.getElementById('grade-select');
  const subjectSel = document.getElementById('subject-select');
  const editionSel = document.getElementById('edition-select');
  const searchInput = document.getElementById('unit-search');

  // 提取所有不重複年級
  const uniqueGrades = [...new Set(manifestData.map(item => item.grade))];
  gradeSel.innerHTML = '<option value="">-- 請選擇年級 --</option>' + 
    uniqueGrades.map(g => `<option value="${g}">${g}</option>`).join('');

  // 1. 年級改變 -> 連動科目
  gradeSel.onchange = () => {
    const selectedGrade = gradeSel.value;
    subjectSel.disabled = !selectedGrade;
    editionSel.disabled = true;
    searchInput.disabled = true;
    editionSel.innerHTML = '<option value="">-- 請先選科目 --</option>';

    if (!selectedGrade) {
      subjectSel.innerHTML = '<option value="">-- 請先選年級 --</option>';
      renderUnitList([]);
      return;
    }

    const availableSubjects = [...new Set(
      manifestData.filter(d => d.grade === selectedGrade).map(d => d.subject)
    )];
    subjectSel.innerHTML = '<option value="">-- 請選擇科目 --</option>' + 
      availableSubjects.map(s => `<option value="${s}">${s}</option>`).join('');
    renderUnitList([]);
  };

  // 2. 科目改變 -> 連動版本
  subjectSel.onchange = () => {
    const selectedGrade = gradeSel.value;
    const selectedSub = subjectSel.value;
    editionSel.disabled = !selectedSub;
    searchInput.disabled = true;

    if (!selectedSub) {
      editionSel.innerHTML = '<option value="">-- 請先選科目 --</option>';
      renderUnitList([]);
      return;
    }

    const availableEditions = [...new Set(
      manifestData.filter(d => d.grade === selectedGrade && d.subject === selectedSub).map(d => d.edition)
    )];
    editionSel.innerHTML = '<option value="">-- 請選擇版本 --</option>' + 
      availableEditions.map(e => `<option value="${e}">${e}</option>`).join('');
    renderUnitList([]);
  };

  // 3. 版本改變 -> 啟用單元搜尋並列出單元
  editionSel.onchange = () => {
    const hasEdition = !!editionSel.value;
    searchInput.disabled = !hasEdition;
    filterAndDisplayUnits();
  };

  // 4. 單元關鍵字搜尋
  searchInput.oninput = filterAndDisplayUnits;
}

function filterAndDisplayUnits() {
  const g = document.getElementById('grade-select').value;
  const s = document.getElementById('subject-select').value;
  const e = document.getElementById('edition-select').value;
  const keyword = document.getElementById('unit-search').value.toLowerCase();

  if (!g || !s || !e) {
    renderUnitList([]);
    return;
  }

  const matched = manifestData.filter(item => 
    item.grade === g &&
    item.subject === s &&
    item.edition === e &&
    item.name.toLowerCase().includes(keyword)
  );

  renderUnitList(matched);
}

function renderUnitList(units) {
  const container = document.getElementById('unit-list');
  if (units.length === 0) {
    container.innerHTML = '<div class="empty-tip">無符合單元</div>';
    checkStartBtn();
    return;
  }

  container.innerHTML = units.map(u => `
    <label class="unit-item" style="display:flex;gap:8px;cursor:pointer;font-size:0.9rem;">
      <input type="checkbox" name="unit-file" value="${u.file}">
      <span>${u.name}</span>
    </label>
  `).join('');

  // 監聽勾選狀態
  container.querySelectorAll('input[name="unit-file"]').forEach(chk => {
    chk.addEventListener('change', checkStartBtn);
  });
  checkStartBtn();
}

function checkStartBtn() {
  const count = document.querySelectorAll('input[name="unit-file"]:checked').length;
  document.getElementById('start-btn').disabled = (count === 0);
}

// ================= 2. 測驗載入與啟動 =================
async function startQuiz() {
  const selectedFiles = Array.from(document.querySelectorAll('input[name="unit-file"]:checked')).map(el => el.value);
  const typeFilter = document.getElementById('type-filter').value;
  const diffFilter = document.getElementById('diff-filter').value;
  const sampleCount = parseInt(document.getElementById('count-filter').value, 10);
  const timerMins = parseInt(document.getElementById('timer-setting').value, 10);

  const startBtn = document.getElementById('start-btn');
  startBtn.innerText = '題庫檔案載入中...';
  startBtn.disabled = true;

  try {
    // 併發 fetch 選中的單元檔案
    const texts = await Promise.all(selectedFiles.map(f => fetch(f).then(r => r.text())));
    let pool = [];
    texts.forEach(t => {
      pool = pool.concat(parseQuestions(t));
    });

    // 依題型與難度篩選
    pool = pool.filter(q => {
      const mType = (typeFilter === 'ALL') || (q.type === typeFilter);
      const mDiff = (diffFilter === 'ALL') || (q.difficulty === diffFilter);
      return mType && mDiff;
    });

    if (pool.length === 0) {
      alert('所選條件下沒有題目，請放寬題型或難度條件！');
      startBtn.innerText = '載入題庫並開始測驗';
      startBtn.disabled = false;
      return;
    }

    // 隨機抽樣
    if (sampleCount > 0 && pool.length > sampleCount) {
      pool = pool.sort(() => Math.random() - 0.5).slice(0, sampleCount);
    }
    activeQuestions = pool;

    // 重置狀態
    userAnswers = {};
    eliminatedMap = {};
    flaggedSet.clear();
    currentIndex = 0;

    startTimer(timerMins);

    // 切換面板
    document.getElementById('setup-view').classList.add('hidden');
    document.getElementById('quiz-view').classList.remove('hidden');

    renderPalette();
    renderCurrentQuestion();
  } catch (err) {
    console.error('題庫載入出錯:', err);
    alert('題庫載入失敗，請確認檔案路徑是否正確！');
    startBtn.innerText = '載入題庫並開始測驗';
    startBtn.disabled = false;
  }
}

// ================= 3. 計時器邏輯 =================
function startTimer(minutes) {
  clearInterval(timerInterval);
  isCountdown = minutes > 0;
  timeSeconds = isCountdown ? minutes * 60 : 0;

  function updateDisplay() {
    const mins = Math.floor(timeSeconds / 60);
    const secs = timeSeconds % 60;
    document.getElementById('quiz-timer').innerText = 
      `⏱️ ${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  }

  updateDisplay();
  timerInterval = setInterval(() => {
    if (isCountdown) {
      timeSeconds--;
      if (timeSeconds <= 0) {
        clearInterval(timerInterval);
        alert('時間結束！系統將自動交卷。');
        submitQuiz();
      }
    } else {
      timeSeconds++;
    }
    updateDisplay();
  }, 1000);
}

// ================= 4. 題目渲染與互動 =================
function renderCurrentQuestion() {
  const q = activeQuestions[currentIndex];

  document.getElementById('quiz-progress-text').innerText = `第 ${currentIndex + 1} / ${activeQuestions.length} 題`;
  document.getElementById('badge-type').innerText = q.type;
  document.getElementById('badge-diff').innerText = q.difficulty;

  // 待檢查按鈕
  document.getElementById('flag-btn').classList.toggle('active', flaggedSet.has(currentIndex));

  // 題組長文
  const groupDesc = document.getElementById('group-desc-box');
  if (q.groupDesc) {
    groupDesc.classList.remove('hidden');
    groupDesc.innerHTML = marked.parse(q.groupDesc);
  } else {
    groupDesc.classList.add('hidden');
  }

  // 題目主體
  document.getElementById('question-text').innerHTML = marked.parse(q.question);

  // 作答區
  const interact = document.getElementById('interaction-area');
  interact.innerHTML = '';
  if (!eliminatedMap[currentIndex]) eliminatedMap[currentIndex] = new Set();

  if (q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE') {
    Object.entries(q.options).forEach(([key, val]) => {
      const isElim = eliminatedMap[currentIndex].has(key);
      const isSelected = q.type === 'SINGLE_CHOICE' 
        ? userAnswers[currentIndex] === key 
        : (userAnswers[currentIndex] || []).includes(key);

      interact.innerHTML += `
        <div class="option-row ${isElim ? 'eliminated' : ''}" id="row-${key}">
          <button class="option-btn ${isSelected ? 'selected' : ''}" onclick="onSelectOption('${key}')">
            <strong>${key}.&nbsp;</strong> ${val}
          </button>
          <button class="eliminate-btn" title="刪去此選項" onclick="toggleEliminate('${key}')">✕</button>
        </div>
      `;
    });
  } else if (q.type === 'TF') {
    const ans = userAnswers[currentIndex];
    interact.innerHTML = `
      <div style="display:flex;gap:16px;">
        <button class="option-btn ${ans==='O'?'selected':''}" style="text-align:center;" onclick="onSelectTF('O')">⭕ 是 (True)</button>
        <button class="option-btn ${ans==='X'?'selected':''}" style="text-align:center;" onclick="onSelectTF('X')">❌ 否 (False)</button>
      </div>
    `;
  } else if (q.type === 'FILL') {
    const val = userAnswers[currentIndex] || '';
    interact.innerHTML = `
      <input type="text" value="${val}" placeholder="請在此輸入答案..." 
        oninput="userAnswers[${currentIndex}] = this.value; renderPalette();" 
        style="width:100%;padding:10px;border-radius:6px;border:1px solid #cbd5e1;box-sizing:border-box;">
    `;
  }

  // LaTeX 公式渲染
  renderMathInElement(document.getElementById('quiz-view'), {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$',  right: '$',  display: false }
    ],
    throwOnError: false
  });

  renderPalette();
}

function onSelectOption(key) {
  if (eliminatedMap[currentIndex].has(key)) return;
  const q = activeQuestions[currentIndex];

  if (q.type === 'SINGLE_CHOICE') {
    userAnswers[currentIndex] = key;
  } else if (q.type === 'MULTI_CHOICE') {
    let arr = userAnswers[currentIndex] || [];
    if (arr.includes(key)) arr = arr.filter(k => k !== key);
    else arr.push(key);
    userAnswers[currentIndex] = arr;
  }
  renderCurrentQuestion();
}

function onSelectTF(val) {
  userAnswers[currentIndex] = val;
  renderCurrentQuestion();
}

function toggleEliminate(key) {
  const set = eliminatedMap[currentIndex];
  if (set.has(key)) set.delete(key);
  else {
    set.add(key);
    const q = activeQuestions[currentIndex];
    if (q.type === 'SINGLE_CHOICE' && userAnswers[currentIndex] === key) delete userAnswers[currentIndex];
    if (q.type === 'MULTI_CHOICE') userAnswers[currentIndex] = (userAnswers[currentIndex] || []).filter(k => k !== key);
  }
  renderCurrentQuestion();
}

// ================= 5. 題號表與跳題 =================
function renderPalette() {
  const grid = document.getElementById('question-palette');
  grid.innerHTML = activeQuestions.map((_, i) => {
    const isCurrent = (i === currentIndex);
    const isAnswered = userAnswers[i] && (Array.isArray(userAnswers[i]) ? userAnswers[i].length > 0 : true);
    const isFlagged = flaggedSet.has(i);

    return `
      <button class="palette-item ${isCurrent?'current':''} ${isAnswered?'answered':''} ${isFlagged?'flagged':''}"
        onclick="currentIndex=${i}; renderCurrentQuestion();">
        ${i + 1}
      </button>
    `;
  }).join('');
}

// ================= 6. 交卷批改與成績總結 =================
function submitQuiz() {
  const unanswered = activeQuestions.filter((_, i) => !userAnswers[i]).length;
  if (unanswered > 0) {
    if (!confirm(`尚有 ${unanswered} 題未作答，確定要交卷結算嗎？`)) return;
  }

  clearInterval(timerInterval);

  let correctCount = 0;
  const reviewContainer = document.getElementById('review-list');
  reviewContainer.innerHTML = '';

  activeQuestions.forEach((q, i) => {
    const uAns = userAnswers[i];
    let isCorrect = false;

    if (q.type === 'MULTI_CHOICE') {
      const uSorted = (uAns || []).sort().join('');
      const cSorted = (Array.isArray(q.answer) ? q.answer : [q.answer]).sort().join('');
      isCorrect = (uSorted === cSorted);
    } else {
      isCorrect = String(uAns || '').trim().toUpperCase() === String(q.answer || '').trim().toUpperCase();
    }

    if (isCorrect) correctCount++;

    reviewContainer.innerHTML += `
      <div class="review-item ${isCorrect ? 'is-correct' : 'is-wrong'}">
        <div style="font-weight:bold;margin-bottom:6px;">第 ${i + 1} 題 [${q.type}]：${isCorrect ? '✅ 答對' : '❌ 答錯'}</div>
        <div class="markdown-body">${marked.parse(q.question)}</div>
        <div style="margin:8px 0;font-size:0.95rem;">
          <div>你的答案：<strong style="color:${isCorrect?'var(--success)':'var(--danger)'};">${JSON.stringify(uAns) || '(未作答)'}</strong></div>
          <div>正確答案：<strong style="color:var(--success);">${JSON.stringify(q.answer)}</strong></div>
        </div>
        ${q.explanation ? `<div class="explanation-box" style="margin-top:10px;">💡 詳解：<br>${marked.parse(q.explanation)}</div>` : ''}
      </div>
    `;
  });

  const finalScore = Math.round((correctCount / activeQuestions.length) * 100);
  document.getElementById('final-score').innerText = finalScore;
  document.getElementById('stat-total').innerText = activeQuestions.length;
  document.getElementById('stat-correct').innerText = correctCount;
  document.getElementById('stat-wrong').innerText = activeQuestions.length - correctCount;
  document.getElementById('stat-time').innerText = document.getElementById('quiz-timer').innerText.replace('⏱️ ', '');

  document.getElementById('quiz-view').classList.add('hidden');
  document.getElementById('result-view').classList.remove('hidden');

  renderMathInElement(reviewContainer, {
    delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
    throwOnError: false
  });
}

// ================= 7. 隨身手寫計算紙 (Scratchpad) =================
function initScratchpad() {
  const canvas = document.getElementById('scratchpad-canvas');
  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let mode = 'pen';

  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1e293b';

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function start(e) { isDrawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function draw(e) {
    if (!isDrawing) return;
    const p = getPos(e);
    ctx.strokeStyle = mode === 'eraser' ? '#f8fafc' : '#1e293b';
    ctx.lineWidth = mode === 'eraser' ? 16 : 2;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function stop() { isDrawing = false; }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('touchstart', start);
  canvas.addEventListener('touchmove', draw);
  canvas.addEventListener('touchend', stop);

  document.getElementById('pen-btn').onclick = () => { mode = 'pen'; document.getElementById('pen-btn').classList.add('active'); document.getElementById('eraser-btn').classList.remove('active'); };
  document.getElementById('eraser-btn').onclick = () => { mode = 'eraser'; document.getElementById('eraser-btn').classList.add('active'); document.getElementById('pen-btn').classList.remove('active'); };
  document.getElementById('clear-canvas-btn').onclick = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ================= 8. 事件綁定 =================
function bindEventHandlers() {
  document.getElementById('start-btn').addEventListener('click', startQuiz);
  
  document.getElementById('prev-btn').onclick = () => { if (currentIndex > 0) { currentIndex--; renderCurrentQuestion(); } };
  document.getElementById('next-btn').onclick = () => { if (currentIndex < activeQuestions.length - 1) { currentIndex++; renderCurrentQuestion(); } };
  document.getElementById('submit-quiz-btn').onclick = submitQuiz;

  document.getElementById('flag-btn').onclick = () => {
    if (flaggedSet.has(currentIndex)) flaggedSet.delete(currentIndex);
    else flaggedSet.add(currentIndex);
    renderCurrentQuestion();
  };

  document.getElementById('palette-toggle-btn').onclick = () => {
    document.getElementById('question-palette').classList.toggle('hidden');
  };

  document.getElementById('scratchpad-btn').onclick = () => document.getElementById('scratchpad-modal').classList.remove('hidden');
  document.getElementById('close-scratchpad-btn').onclick = () => document.getElementById('scratchpad-modal').classList.add('hidden');

  document.getElementById('restart-btn').onclick = () => {
    document.getElementById('result-view').classList.add('hidden');
    document.getElementById('setup-view').classList.remove('hidden');
    document.getElementById('start-btn').innerText = '載入題庫並開始測驗';
    checkStartBtn();
  };
}
