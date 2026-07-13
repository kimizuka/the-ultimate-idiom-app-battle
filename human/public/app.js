'use strict';

let currentIdiom = null;
let hintUsed = false;

// '猫(ねこ)の手(て)' のような表記を <ruby> に変換する
function toRubyHtml(rubyText) {
  return escapeHtml(rubyText).replace(
    /([一-鿿々]+)\(([ぁ-ゖー]+)\)/g,
    '<ruby>$1<rt>$2</rt></ruby>'
  );
}

function escapeHtml(s) {
  const div = document.createElement('div');

  div.textContent = s;

  return div.innerHTML;
}

function show(id) {
  return document.getElementById(id).classList.remove('hidden');
}

function hide(id) {
  return document.getElementById(id).classList.add('hidden');
}

// ---- れんしゅう ----
async function loadQuiz() {
  hide('result');
  hide('error');
  hide('meaning');

  document.getElementById('sentence').value = '';

  hintUsed = false;

  const res = await fetch('/api/quiz');

  currentIdiom = await res.json();

  document.getElementById('idiom').innerHTML = toRubyHtml(currentIdiom.ruby);
  document.getElementById('sentence').focus();
}

document.getElementById('hint-btn').addEventListener('click', () => {
  hintUsed = true;
  document.getElementById('meaning').textContent = `意味: ${currentIdiom.meaning}`;
  show('meaning');
});

document.getElementById('grade-btn').addEventListener('click', async () => {
  const sentence = document.getElementById('sentence').value.trim();

  hide('error');

  if (!sentence) {
    document.getElementById('error').textContent = '例文を書いてから「さいてんする！」をおしてね';
    show('error');

    return;
  }

  document.getElementById('grade-btn').disabled = true;

  show('loading');
  hide('result');

  try {
    const res = await fetch('/api/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idiomId: currentIdiom.id, sentence, hintUsed }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'エラーが起きました');
    }

    const starCount = Math.max(1, Math.round(data.score / 20));

    document.getElementById('stars').textContent = '⭐'.repeat(starCount) + '☆'.repeat(5 - starCount);
    document.getElementById('score').textContent = `${data.score} 点`;
    document.getElementById('comment').textContent = data.comment;
    document.getElementById('model-sentence').innerHTML = escapeHtml(data.model_sentence);

    show('result');

    document.getElementById('result').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    document.getElementById('error').textContent = err.message;
    show('error');
  } finally {
    document.getElementById('grade-btn').disabled = false;
    hide('loading');
  }
});

document.getElementById('next-btn').addEventListener('click', loadQuiz);

// ---- せいせき ----
async function loadStats() {
  const res = await fetch('/api/history');
  const data = await res.json();

  document.getElementById('stat-total').textContent = data.total;
  document.getElementById('stat-avg').textContent = data.total ? `${data.avgScore}点` : '-';
  document.getElementById('stat-progress').textContent = `${data.answeredIdioms} / ${data.totalIdioms}`;

  const weakList = document.getElementById('weak-list');

  weakList.innerHTML = '';

  if (data.weak.length === 0) {
    weakList.innerHTML = `<li class='empty'>にがてな慣用句はないよ！すごい！🎉</li>`;
  } else {
    for (const w of data.weak) {
      const li = document.createElement('li');

      li.innerHTML = `<span>${toRubyHtml(w.ruby)}</span><span class='weak-score'>へいきん ${w.avg}点</span>`;
      weakList.appendChild(li);
    }
  }

  const historyList = document.getElementById('history-list');

  historyList.innerHTML = '';

  if (data.entries.length === 0) {
    historyList.innerHTML = `<p class='empty'>まだきろくがないよ。れんしゅうしてみよう！</p>`;
  } else {
    for (const h of data.entries) {
      const div = document.createElement('div');

      div.className = 'history-item';

      const date = new Date(h.ts).toLocaleString('ja-JP', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });

      div.innerHTML = `
        <div class='history-head'>
          <span>${escapeHtml(h.phrase)}</span>
          <span class='history-score'>${h.score}点</span>
        </div>
        <p class='history-sentence'>「${escapeHtml(h.sentence)}」</p>
        <p class='history-date'>${date}${h.hintUsed ? '・💡ヒントを見た' : ''}</p>`;
      historyList.appendChild(div);
    }
  }
}

// ---- タブ切替 ----
document.getElementById('tab-quiz').addEventListener('click', () => {
  document.getElementById('tab-quiz').classList.add('active');
  document.getElementById('tab-stats').classList.remove('active');
  show('quiz-screen');
  hide('stats-screen');
});

document.getElementById('tab-stats').addEventListener('click', () => {
  document.getElementById('tab-stats').classList.add('active');
  document.getElementById('tab-quiz').classList.remove('active');
  hide('quiz-screen');
  show('stats-screen');
  loadStats();
});

loadQuiz();
