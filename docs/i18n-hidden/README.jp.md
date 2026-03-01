# RAIL

> Codex + Web AI のためのローカルファースト・マルチエージェント・ワークフローデスクトップ（Tauri + React + TypeScript）

RAIL は複数エージェント（Codex / Web AI / ローカルモデル）をノードグラフ（DAG）で接続し、
質問受付 → 分析 → 検証 → 最終統合までをデスクトップ上で一括実行するアプリです。

- ローカル実行中心（Tauri）
- 再現可能な実行ログ（`run-*.json`）
- API キーなしで Web AI を半自動連携（Web Connect 拡張）

---

## 目次

- [解決する課題](#解決する課題)
- [主な機能](#主な機能)
- [動作フロー](#動作フロー)
- [プロジェクト構成](#プロジェクト構成)
- [技術スタック](#技術スタック)
- [要件](#要件)
- [クイックスタート](#クイックスタート)
- [インストール（macOS）](#インストールmacos)
- [利用ガイド](#利用ガイド)
- [Web Connect 設定](#web-connect-設定)
- [データ保存](#データ保存)
- [セキュリティモデル](#セキュリティモデル)
- [法的告知](#法的告知)
- [アーキテクチャ規約](#アーキテクチャ規約)
- [トラブルシューティング](#トラブルシューティング)
- [開発スクリプト](#開発スクリプト)
- [ロードマップ](#ロードマップ)

---

## 解決する課題

単一 AI チャットは速い一方、複雑タスクでは次の問題が起きやすいです。

- 根拠不足 / ハルシネーション
- 長文セッションでのコンテキスト汚染
- 再現性と検証性の低さ
- 役割分担（調査/実装/レビュー/最終統合）の不足

RAIL は **役割別エージェントノード + 実行ログ + 品質ゲート** でこれを補います。

---

## 主な機能

### 1) Workflow Canvas（ノードグラフ）
- `Turn / Transform / Gate` ノード
- 接続・選択・ドラッグ・自動整列
- 実行 / 停止 / Undo / Redo
- エッジと実行状態の可視化

### 2) マルチエージェント実行
- Codex エージェント実行
- Web エージェント半自動連携（`web/gpt`, `web/gemini`, `web/claude`, `web/perplexity`, `web/grok`）
- Ollama ローカルモデル連携
- DAG 上で上流出力を下流入力へ自動伝播

### 3) Feed（結果/文書ビュー）
- カード単位で実行結果表示
- 要約/原文/入力スナップショット/入力出典確認
- 追加要求（追加入力）
- 共有（テキスト/JSON コピー）、削除
- テンプレート実行・カスタム実行単位でグルーピング

### 4) Run Records（再現可能ログ）
- `src-tauri/runs/run-*.json` に保存
- 状態遷移、provider trace、品質サマリーを保持
- 事後検証とデバッグに利用可能

### 5) Settings / Engine
- エンジン開始/停止
- Codex ログイン/ログアウト
- 使用量確認
- CWD 管理

### 6) Web Connect（ブラウザ拡張ブリッジ）
- ローカルループバック（`127.0.0.1`）+ トークン認証
- プロンプト自動注入 + 自動送信試行
- 自動送信失敗時はユーザー 1 回送信でフォールバック
- 応答回収後、次ノードに自動受け渡し

---

## 動作フロー

1. Workflow で質問入力
2. 開始ノード（または DAG 全体）を実行
3. 各ノードで入力処理
   - Turn: LLM 実行
   - Transform: データ整形
   - Gate: 条件分岐
4. 出力を次ノードへ伝播
5. 最終結果を Feed と run に保存
6. Feed から追加要求で対象ノード再実行

---

## プロジェクト構成

```txt
rail/
├─ src/
│  ├─ app/                # アプリルート組み立て
│  ├─ pages/              # ルート単位ページ
│  ├─ components/         # 再利用 UI
│  ├─ features/           # 機能ロジック
│  ├─ shared/
│  │  ├─ tauri/           # IPC ラッパー(invoke/listen)
│  │  └─ lib/             # 共通ユーティリティ
│  └─ i18n/
├─ src-tauri/             # Rust バックエンド + run 保存
├─ extension/rail-bridge/ # Chrome MV3 拡張（Web Connect）
├─ scripts/
├─ docs/
└─ public/
```

---

## 技術スタック

- Desktop: **Tauri v2**
- Frontend: **React 19 + TypeScript + Vite**
- Bridge: **Playwright Core + Chrome Extension (MV3)**
- Data format: JSON（graph / runs）

---

## 要件

- Node.js 18+
- npm 9+
- Rust stable toolchain（Tauri ビルド用）
- Tauri 対応 OS（macOS / Linux / Windows）

---

## クイックスタート

```bash
npm install
npm run dev
```

デスクトップ実行:

```bash
npm run tauri dev
```

本番ビルド:

```bash
npm run build
```

構造 + ビルド検査:

```bash
npm run check
```

---

## インストール（macOS）

RAIL は Web サービスではなく、通常の Tauri デスクトップアプリとして配布します。

### 1) 開発実行

```bash
npm install
npm run tauri dev
```

### 2) リリースアプリ生成

```bash
npm run tauri build -- --bundles app
```

生成物:

- `src-tauri/target/release/bundle/macos/rail.app`

### 3) ローカル実行

1. Finder で `rail.app` を `Applications` へコピー
2. 初回は右クリック → `開く`（macOS 警告回避）

ターミナルから実行:

```bash
open src-tauri/target/release/bundle/macos/rail.app
```

隔離属性でブロックされる場合:

```bash
xattr -dr com.apple.quarantine src-tauri/target/release/bundle/macos/rail.app
open src-tauri/target/release/bundle/macos/rail.app
```

---

## 利用ガイド

### A) 基本実行

1. `Workflow` でテンプレート選択またはノード構成
2. 質問入力
3. 実行ボタン
4. `Feed` で結果確認

### B) Feed から追加要求

1. カード展開
2. 追加要求入力
3. 送信
4. 同一 run コンテキストへ結果追加

### C) グラフ保存/読込

- 保存: 現在グラフをファイル化
- 名前変更: 保存済み名を更新
- 削除: 保存ファイル削除
- 更新: 一覧再同期

### D) 法務文書

- フォント/サードパーティ: `THIRD_PARTY_NOTICES.md`, `public/FONT_LICENSES.txt`
- 投資免責: `DISCLAIMER.md`
- 利用規約/責任制限: `TERMS.md`

---

## Web Connect 設定

### 1) 拡張インストール

1. Chrome `chrome://extensions` を開く
2. デベロッパーモード ON
3. `パッケージ化されていない拡張機能を読み込む`
4. `extension/rail-bridge` を選択

### 1-1) リポジトリ移動/削除時の注意

- `rail.app` 単体で起動可能でも、Web Connect は拡張が必要です。
- 展開読み込みした拡張は、元フォルダが消えると動作しません。
- `extension/rail-bridge` を恒久パスへコピーして再読み込みしてください。

### 2) アプリで接続コード発行

1. アプリの `Web Connect` タブへ
2. `接続コードをコピー`
3. 拡張ポップアップに URL/トークン入力して保存

### 3) ノード設定

- 実行器を Web 系に設定（`web/gpt` など）
- Web 結果モードは `Bridge Assisted（推奨）`

### 4) 実行時挙動

- アプリが自動注入/自動送信を試行
- 失敗時のみブラウザで 1 回送信
- 応答取得後に次ノードへ渡す

---

## データ保存

- グラフファイル: `graphs/*.json`
- 実行ログ: `src-tauri/runs/run-*.json`
- UI ロケール: localStorage (`rail_ui_locale`)

---

## セキュリティモデル

### 基本方針
- ローカルファースト
- 機密情報は最小保持
- ブリッジ通信は最小権限

### Web Connect 保護
- `127.0.0.1` のみ許可
- Bearer トークン認証
- 拡張 ID allowlist オプション
- トークン再発行対応

### 開発時スキャン

```bash
bash scripts/secret_scan.sh --all
```

---

## 法的告知

配布/運用前に下記を確認してください。

- `TERMS.md` : 利用規約 / 責任制限
- `DISCLAIMER.md` : 投資・金融免責
- `THIRD_PARTY_NOTICES.md` : サードパーティ告知
- `public/FONT_LICENSES.txt` : フォントライセンス

重要:
- 株式/金融出力は情報提供であり、投資助言ではありません。
- 最終判断と損益責任はユーザーにあります。

---

## アーキテクチャ規約

構造退行防止のため検査スクリプトを同梱しています。

```bash
npm run check:arch
```

検査対象:
- `src/main.tsx` エントリポイント規約
- ファイル行数上限（例外リスト除く）
- レイヤ依存方向
- cross-slice import 制限

---

## トラブルシューティング

### 1) Web ノードが有効応答なしで終わる
- Web Connect 状態確認
- 対象サービスタブが開いているか確認
- 拡張接続テスト再実行
- 自動送信失敗時は手動で 1 回送信

### 2) 使用量確認失敗
- ログイン/セッション状態確認
- エンジンビルドが usage API 非対応の可能性

### 3) グラフ/Feed が想定と違う
- 最新 run JSON を確認
- 同一 `runId` でグルーピングされているか確認
- 上流→下流接続を再確認

### 4) 開発環境の重さ
- dev サーバー/worker の重複起動確認
- 不要なブラウザ自動化セッション整理

---

## 開発スクリプト

- `npm run dev` : Vite 開発サーバー
- `npm run tauri dev` : Tauri 開発実行
- `npm run tauri:dev:isolated` : Codex ホーム分離(強制)で Tauri 開発実行
- `npm run tauri:dev:global` : グローバル `~/.codex` ホームで Tauri 開発実行(必要時)
- `npm run build` : 型チェック + バンドル
- `npm run check:arch` : 構造規約検査
- `npm run check` : 構造 + ビルド統合検査

注記:
- デフォルト実行は Codex ホームを分離(`isolated`)し、VSCode Codex 履歴と混在しないようにしています。

---

## ロードマップ

- MainApp の追加分割（FSD 強制）
- ページ/機能別テスト強化
- Feed 文書レンダリング（表/チャート/メディア）強化
- 実行/コスト可観測性の改善

---

## License

プロジェクト方針に従います。ライセンス/告知文書を参照してください。
