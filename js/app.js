// 全局狀態
let manifestData = [];
let questionPool = [];       // 篩選出的題庫總題
let activeQuestions = [];      // 抽樣後的測驗題目
let currentIndex = 0;

// 測驗即時狀態
let userAnswers = {};        // { [qIndex]: 'A' 或 ['A','C'] 或 '文字' }
let eliminatedMap = {};      // { [qIndex]: Set(['A', 'D']) }
let flaggedSet = new Set();  // Set([qIndex])
let timerInterval = null;
let timeSeconds = 0;
let isCountdown = false;

// 頁面啟動
document.addEventListener('DOMContentLoaded', async () => {
  const res = await fetch('manifest.json');
  manifestData = await res.json();
  renderSubjectPills();
  bindEventHandlers();
  initScratchpad();
});

// 1. 渲染科目
function renderSubjectPills() {
  const box = document.getElementById('subject-filters');
  box.innerHTML = manifestData.map(s => `
    <label class="pill-label">
      <input type="checkbox" name="subject" value="${s.subject}">
      ${s.subject}
    </label>
  `).join('');
}

// 2. 更新單元清單
function updateUnitList() {
  const selectedSubs = Array.from(document.querySelectorAll('input[name="subject"]:checked')).map(el => el.value);
  const keyword = document.getElementById('unit-search').value.toLowerCase();
  const list = document.getElementById('unit-list');

  let html = '';
  manifestData.forEach(sub => {
    if (selectedSubs.includes(sub.subject)) {
      sub.units.forEach(u => {
        if (u.name.toLowerCase().includes(keyword)) {
          html += `
            <label style="display:flex;gap:8px;font-size:0.9rem;cursor:pointer;">
              <input type="checkbox" name="unit-file" value="${u.file}">
              <span>[${sub.subject}] ${u.name}</span>
            </label>
          `;
        }
      });
    }
  });

  list.innerHTML = html || '<div style="color:#94a3b8;font-size:0.85rem;">請先勾選科目或查無相符單元</div>';
  checkStartBtn();
}

// 3. 測驗開始：併發抓取、抽樣與計時器啟動
async function startQuiz() {
  const selectedFiles = Array.from(document.querySelectorAll('input[name="unit-file"]:checked')).map(el => el.value);
  const typeFilter = document.getElementById('type-filter').value;
  const diffFilter = document.getElementById('diff-filter').value;
  const sampleCount = parseInt(document.getElementById('count-filter').value, 10);
  const timerMins = parseInt(document.getElementById('timer-setting').value, 10);

  document.getElementById('start-btn').innerText = '載入題庫中...';

  // 抓取並解析 .md 檔案
  const texts = await Promise.all(selectedFiles.map(f => fetch(f).then(r => r.text())));
  let pool = [];
  texts.forEach(t => { pool = pool.concat(parseQuestions(t)); });

  // 題型與難度篩選
  pool = pool.filter(q => {
    const mType = (typeFilter === 'ALL') || (q.type === typeFilter);
    const mDiff = (diffFilter === 'ALL') || (q.difficulty === diffFilter);
    return mType && mDiff;
  });

  if (pool.length === 0) {
    alert('在選取的條件下沒有題目，請放寬條件！');
    document.getElementById('start-btn').innerText = '開始測驗';
    return;
  }

  // 隨機抽樣 (若設定非全部)
  if (sampleCount > 0 && pool.length > sampleCount) {
    pool = pool.sort(() => Math.random() - 0.5).slice(0, sampleCount);
  }
  activeQuestions = pool;

  // 初始化狀態
  userAnswers = {};
  eliminatedMap = {};
  flaggedSet.clear();
  currentIndex = 0;

  // 計時器啟動
  startTimer(timerMins);

  // 切換畫面
  document.getElementById('setup-view').classList.add('hidden');
  document.getElementById('quiz-view').classList.remove('hidden');

  renderPalette();
  renderCurrentQuestion();
}

// 4. 計時器邏輯
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
        alert('時間到！系統將自動交卷。');
        submitQuiz();
      }
    } else {
      timeSeconds++;
    }
    updateDisplay();
  }, 1000);
}

// 5. 渲染題目與互動
function renderCurrentQuestion() {
  const q = activeQuestions[currentIndex];

  document.getElementById('quiz-progress-text').innerText = `第 ${currentIndex + 1} / ${activeQuestions.length} 題`;
  document.getElementById('badge-type').innerText = q.type;
  document.getElementById('badge-diff').innerText = q.difficulty;

  // 待檢查按鈕狀態
  const flagBtn = document.getElementById('flag-btn');
  flagBtn.classList.toggle('active', flaggedSet.has(currentIndex));

  // 題組文章
  const groupDesc = document.getElementById('group-desc-box');
  if (q.groupDesc) {
    groupDesc.classList.remove('hidden');
    groupDesc.innerHTML = marked.parse(q.groupDesc);
  } else {
    groupDesc.classList.add('hidden');
  }

  // 題目內文
  document.getElementById('question-text').innerHTML = marked.parse(q.question);

  // 作答區渲染
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
        style="width:100%;padding:10px;border-radius:6px;border:1px solid #cbd5e1;">
    `;
  }

  // 公式渲染
  renderMathInElement(document.getElementById('quiz-view'), {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$',  right: '$',  display: false }
    ],
    throwOnError: false
  });

  renderPalette();
}

// 6. 選項作答與刪去法行為
function onSelectOption(key) {
  if (eliminatedMap[currentIndex].has(key)) return; // 被劃掉的選項不能選

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
    // 若該選項已選中則取消作答
    const q = activeQuestions[currentIndex];
    if (q.type === 'SINGLE_CHOICE' && userAnswers[currentIndex] === key) delete userAnswers[currentIndex];
    if (q.type === 'MULTI_CHOICE') userAnswers[currentIndex] = (userAnswers[currentIndex] || []).filter(k => k !== key);
  }
  renderCurrentQuestion();
}

// 7. 題號清單 (Palette) 渲染與跳題
function renderPalette() {
  const grid = document.getElementById('question-palette');
  grid.innerHTML = activeQuestions.map((_, i) => {
    const isCurrent = i === currentIndex;
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

// 8. 交卷批改與成績總結
function submitQuiz() {
  const unanswered = activeQuestions.filter((_, i) => !userAnswers[i]).length;
  if (unanswered > 0) {
    if (!confirm(`尚有 ${unanswered} 題未作答，確定要現在交卷結算嗎？`)) return;
  }

  clearInterval(timerInterval);

  let correctCount = 0;
  const reviewContainer = document.getElementById('review-list');
  reviewContainer.innerHTML = '';

  activeQuestions.forEach((q, i) => {
    const uAns = userAnswers[i];
    let isCorrect = false;

    // 比對答案
    if (q.type === 'MULTI_CHOICE') {
      const uSorted = (uAns || []).sort().join('');
      const cSorted = (Array.isArray(q.answer) ? q.answer : [q.answer]).sort().join('');
      isCorrect = uSorted === cSorted;
    } else {
      isCorrect = String(uAns || '').trim().toUpperCase() === String(q.answer || '').trim().toUpperCase();
    }

    if (isCorrect) correctCount++;

    // 產生逐題檢視卡片
    reviewContainer.innerHTML += `
      <div class="review-item ${isCorrect ? 'is-correct' : 'is-wrong'}">
        <div style="font-weight:bold;margin-bottom:6px;">第 ${i + 1} 題 [${q.type}]：${isCorrect ? '✅ 答對' : '❌ 答錯'}</div>
        <div class="markdown-body">${marked.parse(q.question)}</div>
        <div style="margin:8px 0;font-size:0.95rem;">
          <div>你的答案：<strong style="color:${isCorrect?'var(--success)':'var(--danger)'};">${JSON.stringify(uAns) || '(未作答)'}</strong></div>
          <div>正確答案：<strong style="color:var(--success);">${JSON.stringify(q.answer)}</strong></div>
        </div>
        ${q.explanation ? `<div class="explanation-box">💡 詳解：<br>${marked.parse(q.explanation)}</div>` : ''}
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

// 9. 手寫計算紙畫布 (支援觸控筆與滑鼠)
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

// 綁定所有點擊事件
function bindEventHandlers() {
  document.getElementById('subject-filters').addEventListener('change', updateUnitList);
  document.getElementById('unit-search').addEventListener('input', updateUnitList);
  document.getElementById('unit-list').addEventListener('change', checkStartBtn);
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

  // 草稿紙開關
  document.getElementById('scratchpad-btn').onclick = () => document.getElementById('scratchpad-modal').classList.remove('hidden');
  document.getElementById('close-scratchpad-btn').onclick = () => document.getElementById('scratchpad-modal').classList.add('hidden');

  document.getElementById('restart-btn').onclick = () => {
    document.getElementById('result-view').classList.add('hidden');
    document.getElementById('setup-view').classList.remove('hidden');
  };
}

function checkStartBtn() {
  const count = document.querySelectorAll('input[name="unit-file"]:checked').length;
  document.getElementById('start-btn').disabled = count === 0;
}
