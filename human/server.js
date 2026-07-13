import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// 採点に使うバックエンド: "ollama"（デフォルト）または "anthropic"
const GRADER = process.env.GRADER || "ollama";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:26b";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const IDIOMS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "idioms.json"), "utf-8")
);
const HISTORY_PATH = path.join(__dirname, "data", "history.json");

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

// ---- 出題ロジック：未出題と苦手（低得点）を重み付きで優先 ----
function pickIdiom(history) {
  const lastScore = new Map();

  for (const h of history) {
    lastScore.set(h.idiomId, h.score);
  }

  const lastAskedId = history.length ? history[history.length - 1].idiomId : null;
  const weighted = IDIOMS.map((idiom) => {
    let weight;

    if (!lastScore.has(idiom.id)) {
      weight = 3; // まだやっていない
    } else if (lastScore.get(idiom.id) < 60) {
      weight = 4; // 苦手
    } else if (lastScore.get(idiom.id) < 80) {
      weight = 2; // もう少し
    } else {
      weight = 1; // 得意
    }

    if (idiom.id === lastAskedId) {
      weight = 0.1; // 直前と同じ問題は避ける
    }

    return { idiom, weight };
  });

  const total = weighted.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;

  for (const { idiom, weight } of weighted) {
    r -= weight;

    if (r <= 0) {
      return idiom;
    }
  }

  return weighted[weighted.length - 1].idiom;
}

// ---- AI採点 ----
const GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    usage_correct: { type: "boolean" },
    comment: { type: "string" },
    model_sentence: { type: "string" },
  },
  required: ["score", "usage_correct", "comment", "model_sentence"],
};

function buildPrompt(idiom, sentence) {
  return {
    system: `あなたは小学校の国語の先生です。小学校高学年の子どもが、慣用句を使った例文を作る練習をしています。子どもが作った例文を採点してください。

採点基準:
- 最も大事なのは「慣用句の意味を正しく理解して使えているか」です。正しく使えていれば80点以上をつけてください。
- 意味を誤解して使っている場合は50点以下にしてください。
- 例文に慣用句が使われていない場合や、意味の説明を書いただけの場合は30点以下にしてください。
- 文としての自然さや、場面が目にうかぶ具体性は加点要素です。
- 意味が正しく、文も自然で、場面が具体的に目にうかぶ例文には、遠慮せず100点をつけてください。

commentの書き方:
- まず必ず良いところをほめてから、直すとよい点をやさしくアドバイスしてください。
- 小学生に分かる言葉で、2〜3文で書いてください。
- 小学生が読む文です。誤字や不自然な日本語がないか、出力前に見直してください。
- 意味を誤解している場合は、正しい意味をやさしく説明してください。

model_sentenceには、その慣用句を正しく使ったお手本の例文を1つ書いてください。`,
    user: `慣用句:「${idiom.phrase}」
正しい意味: ${idiom.meaning}

子どもが作った例文:
「${sentence}」

この例文を採点してください。`,
  };
}

async function gradeWithOllama(idiom, sentence) {
  const { system, user } = buildPrompt(idiom, sentence);
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: GRADE_SCHEMA,
      options: { temperature: 0.2 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);

  const data = await res.json();

  return JSON.parse(data.message.content);
}

async function gradeWithAnthropic(idiom, sentence) {
  const { system, user } = buildPrompt(idiom, sentence);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: `${system}\n\n必ず次のキーを持つJSONだけを出力してください: score(0〜100の整数), usage_correct(真偽値), comment(文字列), model_sentence(文字列)`,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.content[0].text;
  const match = text.match(/\{[\s\S]*\}/);

  if (!match) {
    throw new Error(`JSONが見つかりません: ${text}`);
  }

  return JSON.parse(match[0]);
}

async function grade(idiom, sentence) {
  const result =
    GRADER === "anthropic"
      ? await gradeWithAnthropic(idiom, sentence)
      : await gradeWithOllama(idiom, sentence);

  result.score = Math.max(0, Math.min(100, Math.round(result.score)));
  // お手本例文は人が監修したものを優先（AI生成は example がない問題のフォールバック）
  result.model_sentence = idiom.example ?? result.model_sentence;

  return result;
}

// ---- サーバー ----
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/quiz", (req, res) => {
  const idiom = pickIdiom(loadHistory());

  res.json(idiom);
});

app.post("/api/grade", async (req, res) => {
  const { idiomId, sentence, hintUsed } = req.body ?? {};
  const idiom = IDIOMS.find((i) => i.id === idiomId);

  if (!idiom) {
    return res.status(400).json({ error: "問題が見つかりません" });
  }

  if (!sentence || !sentence.trim()) {
    return res.status(400).json({ error: "例文を入力してください" });
  }

  try {
    const result = await grade(idiom, sentence.trim());
    const history = loadHistory();

    history.push({
      ts: new Date().toISOString(),
      idiomId: idiom.id,
      phrase: idiom.phrase,
      sentence: sentence.trim(),
      hintUsed: !!hintUsed,
      score: result.score,
      usage_correct: result.usage_correct,
      comment: result.comment,
      model_sentence: result.model_sentence,
    });
    saveHistory(history);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "採点に失敗しました。もう一度ためしてね。" });
  }
});

app.get("/api/history", (req, res) => {
  const history = loadHistory();
  const total = history.length;
  const avgScore = total
    ? Math.round(history.reduce((s, h) => s + h.score, 0) / total)
    : 0;
  const byIdiom = new Map(); // 慣用句ごとの平均点を出し、低い順に「苦手トップ5」

  for (const h of history) {
    if (!byIdiom.has(h.idiomId)) {
      byIdiom.set(h.idiomId, []);
    }

    byIdiom.get(h.idiomId).push(h.score);
  }

  const weak = [...byIdiom.entries()]
    .map(([idiomId, scores]) => {
      const idiom = IDIOMS.find((i) => i.id === idiomId);

      return {
        idiomId,
        phrase: idiom?.phrase ?? "?",
        ruby: idiom?.ruby ?? "",
        avg: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
        attempts: scores.length,
      };
    })
    .filter((w) => w.avg < 80)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 5);

  res.json({
    total,
    avgScore,
    answeredIdioms: byIdiom.size,
    totalIdioms: IDIOMS.length,
    weak,
    entries: [...history].reverse(),
  });
});

app.listen(PORT, () => {
  console.log(`慣用句 is: http://localhost:${PORT}`);
  console.log(`採点: ${GRADER === "anthropic" ? `Anthropic (${ANTHROPIC_MODEL})` : `Ollama (${OLLAMA_MODEL})`}`);
});
