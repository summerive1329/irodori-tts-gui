# Irodori TTS GUI Design

## Goal

`Irodori-TTS` を submodule として取り込み、このリポジトリから参照音声ベースの音声生成を GUI で扱えるようにする。MVP では、複数参照音声の登録、複数セリフの編集、`line x reference` セル単位の生成と再生成、採用結果の選択、任意順での結合書き出し、ローカル保存と再開を可能にする。

## Scope

### In Scope

- `Aratako/Irodori-TTS` を submodule として親リポジトリに追加する
- `React` フロントエンドと `FastAPI` バックエンドを持つローカル Web アプリを作る
- 複数参照音声を登録し、それぞれについて同じセリフ一覧を一括生成する
- テキスト系ファイルをドラッグ&ドロップし、改行区切りでセリフを既存一覧の末尾へ追記できるようにする
- 同一プロセス内で `InferenceRuntime` を再利用し、複数セリフ生成時にモデルを毎回再ロードしない
- 同一参照音声について reference latent を再利用し、行ごとの再エンコードを避ける
- セリフごと、参照音声ごとに生成セルを分け、特定セルだけ再生成できるようにする
- 各セリフについて、どのセルの結果を採用するかを選べるようにする
- 採用済みセリフを指定順で結合し、結合 WAV を出力する
- ローカルに project データを保存し、後から再開できるようにする

### Out of Scope for MVP

- 1 セル内の複数候補履歴の UI 切り替え
- 複数候補の同時生成と比較 UI
- クラウド共有やマルチユーザー対応
- Electron 化などのデスクトップ配布
- 学習、VoiceDesign 専用 UI、詳細 CFG 全項目のフル露出

## Architecture

システムは 3 層に分ける。

1. `frontend/app`
   - `React` ベースのブラウザ UI
   - 参照音声、セリフ、セル状態、採用状態、保存済み project 一覧を表示する
   - マトリクス表と詳細ペインを中心に操作を提供する

2. `backend/app`
   - `FastAPI` ベースのローカル API
   - project 保存、セリフ/参照音声管理、生成ジョブ、再生成、結合書き出しを担当する
   - `Irodori-TTS` submodule の Python 実装を import して利用する

3. `vendor/Irodori-TTS`
   - Git submodule
   - 推論 runtime、codec、reference latent 処理、既存の batch ロジックを再利用する

バックエンドは単一プロセスで動かし、checkpoint / device 設定ごとに runtime をキャッシュする。生成時は project 内の参照音声ごとに reference latent をロードして再利用し、同一バッチ中の複数行生成に使い回す。

## User Experience

MVP の画面はデスクトップ優先で、一覧中心レイアウトを採用する。

### Main Layout

- 上部ヘッダ
  - project 名
  - 保存
  - project 読み込み
  - 一括生成
  - 結合書き出し
- 左ペイン
  - 参照音声一覧
  - 参照音声の追加、削除
  - 各参照音声の短いラベル表示
- 中央ペイン
  - セリフ取り込み用ドロップゾーン
  - セリフ一覧マトリクス
  - 行はセリフ、列は参照音声
  - 各セルは `未生成 / 生成中 / 完了 / エラー` 状態を持つ
  - 各セルには再生、再生成、採用トグルを持たせる
- 右ペイン
  - 選択中セルの詳細
  - 対象セリフ本文
  - 対象参照音声
  - 現在の出力パス
  - 再生成操作
  - export 順確認

### Cell Interaction Model

セルは `line x reference` の組で一意に決まる。`regen` はセル単位にのみ作用する。たとえば `line_03 x toru` を再生成しても `line_03 x lize` や `line_04 x toru` は変わらない。

MVP のセルは表示上 `現在結果 1 件` のみを持つ。内部データ構造は将来 `attempts[]` へ拡張しやすい形にしておくが、現段階では最新結果だけを `current_result` として扱う。

### Line Import Model

セリフ一覧にはファイルドラッグ&ドロップによる追加入力を持たせる。対象は `txt`, `md`, `csv`, `tsv` のようなテキスト系ファイルを基本とし、MVP では内容をプレーンテキストとして扱う。1 行を 1 セリフとして読み込み、空行はスキップする。

インポートは既存セリフを置き換えず、常に既存一覧の末尾へ追加する。`order_index` は現在の最大値の次から順に採番する。Windows 環境を考慮し、文字コードは `UTF-8`, `UTF-8 BOM`, `CP932` の順で解決を試みる。

### Export Model

結合対象は「各セリフに対して 1 つ選ばれた採用結果」の列である。ユーザーは各行ごとにどの参照音声セルを採用するか選べる。全行に採用結果が揃っている場合だけ書き出しを許可する。未採用行がある場合は、export を止めて不足行を返す。

## Data Model

project データはローカル JSON とメディアファイル群で管理する。

### Project

- `id`
- `name`
- `created_at`
- `updated_at`
- `checkpoint`
- `model_device`
- `model_precision`
- `codec_device`
- `codec_precision`
- `references[]`
- `lines[]`
- `cells[]`
- `export_order[]`

### Reference

- `id`
- `label`
- `source_path`
- `copied_path`
- `duration_sec`

### Line

- `id`
- `text`
- `order_index`

### Cell

- `id`
- `line_id`
- `reference_id`
- `status`
- `error_message`
- `current_result`
- `selected_for_export`

### CellResult

- `audio_path`
- `sample_rate`
- `generated_at`
- `seed`
- `duration_sec`

将来拡張時は `current_result` を `attempts[]` と `selected_attempt_id` に差し替える。`Cell` の外部キー設計を固定しておけば、保存済み project のマイグレーションも比較的素直にできる。

## Storage Layout

ローカル保存先は repo 配下、またはアプリ用作業ディレクトリ配下に統一する。

想定レイアウト:

```text
project_data/
  projects/
    <project-id>/
      project.json
      references/
        <reference-id>.wav
      cells/
        <line-id>__<reference-id>.wav
      exports/
        export_<timestamp>.wav
```

project 読み込み時は `project.json` を基準にファイルパスを解決する。参照音声は外部パスをそのまま持つのではなく、project 管理下へコピーしたパスを主に使う。これにより後で元ファイルが動いても project が壊れにくくなる。

## Backend Design

### Runtime Reuse

バックエンドに `IrodoriRuntimeManager` を置く。

- checkpoint と device 設定をキーに `InferenceRuntime` を保持する
- 同じ設定では再ロードせず、既存 runtime を返す
- 参照音声ごとの latent も別キャッシュで持つ
- latent キャッシュキーは `project_id + reference_id + reference_file_mtime + checkpoint` を基本にする

### Generation Flow

1. project を読み込む
2. runtime manager から runtime を取得する
3. 対象参照音声について latent を取得する
4. 対象行テキストごとに `SamplingRequest` を組み立てる
5. `ref_latent_tensor` を渡して順次生成する
6. セル出力を保存し、`project.json` を更新する

一括生成は「参照音声ごとに latent を 1 回だけ用意し、その参照音声に対する全行をまとめて処理する」構成を基本とする。これにより、モデル再ロードと reference encode の無駄を避ける。

### API Surface

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}`
- `PUT /api/projects/{project_id}`
- `POST /api/projects/{project_id}/references`
- `POST /api/projects/{project_id}/lines/import`
- `POST /api/projects/{project_id}/generate/all`
- `POST /api/projects/{project_id}/cells/{cell_id}/regenerate`
- `POST /api/projects/{project_id}/export`

`POST /api/projects/{project_id}/lines/import` は multipart upload を受け取り、テキスト抽出後に新しい `Line` を末尾追加して更新済み project を返す。

MVP では非同期キュー基盤は入れず、FastAPI プロセス内でジョブを管理する。フロントエンドはポーリングで状態更新を受ける。ジョブが増えてから WebSocket や永続キューへ拡張する。

## Frontend Design

### Views

- `ProjectHome`
  - project 一覧と新規作成
- `ProjectEditor`
  - 参照音声一覧
  - セリフ入力エリア
  - マトリクス表
  - 詳細ペイン

### Interaction Rules

- 参照音声追加時は新しい列が生える
- セリフ追加時は新しい行が生える
- テキストファイルをドロップしたときは、改行ごとに新しい行が末尾追加される
- 一括生成は「未生成セル」または「全セル」を対象に選べるようにする
- セル再生成は単一セルのみ対象とする
- 採用操作は 1 行につき 1 セルだけ true になるよう制御する
- 行順変更時はマトリクスと export 順が同時に更新される

### UI States

- idle
- loading project
- generating batch
- regenerating cell
- exporting
- error

MVP では progress 表示を簡素にし、行数、完了数、現在処理中の参照音声とセリフを見せる。

## Integration with Irodori-TTS

submodule の配置先は `vendor/Irodori-TTS` を第一候補とする。バックエンド側で import path を通し、`InferenceRuntime`, `SamplingRequest`, `save_wav` と、必要に応じて既存 batch ロジックを使う。

既存の `line_batch.py` と `inference_runtime.py` にすでにある runtime 再利用の考え方を踏襲し、GUI 用には以下を薄く追加する。

- project ベースの保存レイヤ
- API 呼び出し向けの service 層
- セル単位ジョブ実行関数

submodule 側の変更は最小限に抑え、できるだけ親リポジトリ側の adapter で吸収する。

## Error Handling

- 参照音声ファイルが読めない場合
  - 対応セルを error にし、理由を表示する
- checkpoint 解決に失敗した場合
  - batch 全体を止めて設定エラーとして返す
- 行インポートファイルがテキストとして読めない場合
  - import 全体を止め、未対応形式または decode エラーとして返す
- export 時に未採用行がある場合
  - 書き出しを止め、不足行 ID を返す
- セル再生成失敗時
  - 他セルは維持し、対象セルだけ error にする

## Testing Strategy

### Backend

- runtime manager が同一設定で runtime を再利用すること
- 同一参照音声で latent を再利用すること
- 一括生成が複数行を 1 runtime で処理すること
- cell 再生成が対象セル以外を変更しないこと
- project 保存と再読込で状態が復元されること
- 行インポートが既存行を消さず末尾へ追加すること
- 行インポートが空行をスキップすること
- export が未採用行を検知すること

### Frontend

- 行追加、列追加でマトリクスが更新されること
- 採用切り替えが 1 行 1 選択に保たれること
- セル再生成ボタンが正しい cell_id を送ること
- project 読込時に保存済み状態が再描画されること
- ドラッグ&ドロップで追加した行がマトリクスに即時反映されること

### End-to-End

- 2 つの参照音声、3 つのセリフを読み込み、一括生成できること
- テキストファイルをドロップしてセリフが末尾追加されること
- 特定セルを再生成し、他セルが不変なこと
- 各行で別々の参照音声を選んで export できること

## Migration Path

MVP 後に 1 セル内の履歴保持を追加する場合は、以下の順で拡張する。

1. `Cell.current_result` を `Cell.attempts[]` と `selected_attempt_id` に置き換える
2. セル詳細ペインに履歴一覧を追加する
3. 再生成時は結果を上書きせず追加する
4. export は selected attempt を参照する

この設計により、今回の MVP 実装を大きく壊さずに後方拡張できる。
