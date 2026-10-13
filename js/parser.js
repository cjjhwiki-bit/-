/**
 * 純文字題庫解析器 (parser.js)
 * 職責：將純文字 Markdown 格式題庫轉換為標準 JavaScript 題目物件陣列
 */

// 1. 全局主進入點：接收整個檔案的純文字
function parseQuestions(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  // 統一將 Windows 換行 (\r\n) 轉為 Unix 換行 (\n)
  const normalizedText = rawText.replace(/\r\n/g, '\n');

  // 以題目分隔線 "---" 切割題目區塊
  const rawBlocks = normalizedText.split(/\n\s*---\s*\n/);
  const questions = [];

  let qIndexCounter = 0;

  for (const block of rawBlocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) continue;

    // 判斷是否為題組區塊
    if (trimmedBlock.startsWith('[GROUP]')) {
      const groupQuestions = parseGroupBlock(trimmedBlock, qIndexCounter);
      questions.push(...groupQuestions);
      qIndexCounter += groupQuestions.length;
    } else {
      const singleQ = parseSingleQuestion(trimmedBlock, qIndexCounter);
      if (singleQ) {
        questions.push(singleQ);
        qIndexCounter++;
      }
    }
  }

  return questions;
}

// 2. 解析單一題目區塊
function parseSingleQuestion(blockText, index = 0) {
  const lines = blockText.split('\n');

  // 預設屬性
  let rawType = null;
  let difficulty = "中等";
  let answer = "";
  
  let options = {};
  let qTextLines = [];
  let expTextLines = [];
  
  // 讀取狀態標記 (狀態機)
  let currentField = null; // 'Q', 'EXP', 或 null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      // 保留題目或詳解內部的空行（維持 Markdown 排版）
      if (currentField === 'Q') qTextLines.push('');
      if (currentField === 'EXP') expTextLines.push('');
      continue;
    }

    if (trimmed.startsWith('Q:')) {
      currentField = 'Q';
      qTextLines.push(trimmed.substring(2).trim());
    } else if (/^[A-Z]\./i.test(trimmed)) {
      currentField = null; // 遇到選項，結束題目內容讀取
      const optKey = trimmed[0].toUpperCase();
      options[optKey] = trimmed.substring(2).trim();
    } else if (trimmed.startsWith('ANS:')) {
      currentField = null;
      answer = trimmed.substring(4).trim();
    } else if (trimmed.startsWith('DIFF:')) {
      currentField = null;
      difficulty = trimmed.substring(5).trim();
    } else if (trimmed.startsWith('TYPE:')) {
      currentField = null;
      rawType = trimmed.substring(5).trim().toUpperCase();
    } else if (trimmed.startsWith('EXP:')) {
      currentField = 'EXP';
      expTextLines.push(trimmed.substring(4).trim());
    } else {
      // 多行文字累積（表格、圖片標籤、換行文字等）
      if (currentField === 'Q') {
        qTextLines.push(line);
      } else if (currentField === 'EXP') {
        expTextLines.push(line);
      }
    }
  }

  const question = qTextLines.join('\n').trim();
  const explanation = expTextLines.join('\n').trim();

  // 必填檢查：沒有題目或沒有答案視為無效題，直接略過
  if (!question || !answer) return null;

  // 處理選項：若未寫任何選項，直接給予 null
  const hasOptions = Object.keys(options).length > 0;
  const finalOptions = hasOptions ? options : null;

  // 智慧判斷題型
  let finalType = rawType;
  let finalAnswer = answer;

  if (!finalType) {
    if (hasOptions) {
      // 檢查答案是否包含逗號或多個字母（如 "A, C" 或 "ACD"）
      const lettersOnly = answer.replace(/[^A-Za-z]/g, '').toUpperCase();
      if (lettersOnly.length > 1) {
        finalType = "MULTI_CHOICE"; // 自動判定為多選題
        finalAnswer = lettersOnly.split(''); // 正規化為陣列 ['A', 'C']
      } else {
        finalType = "SINGLE_CHOICE"; // 單選題
        finalAnswer = lettersOnly || answer.toUpperCase();
      }
    } else if (/^[OX對錯TF]$/i.test(answer)) {
      finalType = "TF"; // 是非題
      finalAnswer = answer.toUpperCase();
    } else {
      finalType = "FILL"; // 填充題
    }
  }

  return {
    id: `q_${index + 1}`,
    type: finalType,
    difficulty: difficulty,
    question: question,
    options: finalOptions, // 沒填就是 null
    answer: finalAnswer,
    explanation: explanation
  };
}

// 3. 解析題組區塊並扁平化展開
function parseGroupBlock(blockText, baseIndex = 0) {
  // 移除前後 [GROUP] 與 [/GROUP]
  const innerContent = blockText
    .replace(/^\[GROUP\]\s*/i, '')
    .replace(/\s*\[\/GROUP\]$/i, '');

  // 尋找第一個 "Q:" 出現的位置，前段為文章 DESC，後段為各道題目
  const firstQIndex = innerContent.indexOf('Q:');
  if (firstQIndex === -1) return [];

  const descPart = innerContent.substring(0, firstQIndex).trim();
  const questionsPart = innerContent.substring(firstQIndex);

  // 清理 DESC: 標籤
  const groupDesc = descPart.replace(/^DESC:\s*/i, '').trim();

  // 以正規表達式根據 "Q:" 拆分小題
  const qBlocks = questionsPart.split(/(?=\nQ:|^Q:)/g).map(b => b.trim()).filter(Boolean);
  const subQuestions = [];

  qBlocks.forEach((qBlock, idx) => {
    const qObj = parseSingleQuestion(qBlock, baseIndex + idx);
    if (qObj) {
      // 綁定題組文章
      qObj.groupDesc = groupDesc;
      subQuestions.push(qObj);
    }
  });

  return subQuestions;
}

// 暴露到全域環境供 app.js 呼叫
window.parseQuestions = parseQuestions;
