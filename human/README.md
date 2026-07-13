# 慣用句 is

小学校高学年向けの慣用句練習アプリ。出題された慣用句で例文を作ると、AI（ローカルのOllama）が採点してフィードバックしてくれます。

## 使い方

Node.js と pnpm のバージョンは [mise](https://mise.jdx.dev/) で固定しています（`mise.toml`）。事前に mise をインストールしておいてください。

```bash
mise install # 初回のみ。mise.toml に固定されたNode.jsとpnpmが入る
pnpm install --frozen-lockfile # 初回のみ
PORT=3456 pnpm start
```

ブラウザで http://localhost:3456 を開く。
※ Ollama が起動していること（`ollama serve`）。採点には `gemma4:26b` を使います（1回 30秒前後）。

同じWi-Fi内のタブレット等からは `http://<このMacのIPアドレス>:3456` でアクセスできます。

## 設定（環境変数）

`.env.example` を `.env` にコピーして編集すると、`pnpm start` 時に自動で読み込まれます（`.env` はgitにコミットされません）。

```bash
cp .env.example .env
```

| 変数 | デフォルト | 説明 |
|---|---|---|
| `PORT` | 3000 | サーバーのポート |
| `OLLAMA_MODEL` | gemma4:26b | 採点に使うOllamaモデル |
| `GRADER` | ollama | `anthropic` にするとClaude APIで採点（`ANTHROPIC_API_KEY` が必要。高速・高品質） |

APIキーなどの機密情報はコマンドラインに直接書かず（シェル履歴に残るため）、`.env` に書いてください。

## データ

- `data/idioms.json` — 出題される慣用句（70問）。同じ形式で自由に追加OK。`example` は採点結果で表示されるお手本例文（省くとAIが生成）
- `data/history.json` — 回答履歴。`[]` にリセットすればやり直せる
