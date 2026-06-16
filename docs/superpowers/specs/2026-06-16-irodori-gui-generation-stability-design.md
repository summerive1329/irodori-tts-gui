# Irodori GUI Generation Stability Design

## Goal

`Irodori Studio` の非レイアウト系の残件のうち、生成操作まわりの分かりにくさと不安定さを先に潰す。今回の対象は次の 4 点である。

- `全セルを実行 / 未生成を実行` の件数表示を、起動ジョブ数ではなく対象セル数ベースへ揃える
- マトリックス上で複数セルを選択してまとめて再生成できるようにする
- 生成開始 API と UI の両方で多重起動を抑制し、連打での 500 エラーを減らす
- 次回の不具合調査に使える最低限のアプリ内ログを残せるようにする

## Scope

### In Scope

- backend の `generation_progress` 集約ルールの見直し
- 複数セル再生成 API の追加
- frontend の複数セル選択 UI と一括再生成導線
- 生成開始 API の重複起動ガード
- メモリ上で保持する簡易アプリケーションログの追加

### Out of Scope

- 固定レイアウト、独立スクロール、先頭行固定
- テーマカラーの再設計
- 行の番号指定移動
- 削除取り消しタイマーの可視化
- 音声プレイヤーのデザイン刷新

## Problem Summary

現在の生成まわりには、仕様と実装の粒度が揃っていない箇所がある。

- `GenerationConsole` の `running_job_count` は backend で「実行中ジョブ本数」を返しており、`generate_all` で複数セルを処理していても 1 件に見える
- 再生成は 1 セル単位の API しかなく、ユーザーが比較中の複数セルをまとめてやり直せない
- frontend では `busy` によりボタンを止めているが、ジョブ開始直後の更新タイミングや別経路からの開始が重なると API 側で二重起動を拒否できない
- 障害時の手掛かりが `uvicorn` 標準ログに寄っており、GUI の操作文脈が残らない

今回の修正では、ユーザーの見ている「セル単位」の操作と、backend が持つ「ジョブ単位」の内部表現の間に薄い変換層を足し、表示・操作・安定性を揃える。

## Design Direction

### 1. Progress Count Becomes Target-Cell Count

`generation_progress.running_job_count` は名前を維持したまま、意味を「いま処理対象として走っているセル件数」に変更する。

- `generate_all` や `generate_missing` は、1 ジョブでも `target_cell_ids` の件数だけカウントする
- `regenerate_cell` は従来通り 1 件になる
- `active_jobs` は「いま先頭で見せる代表セル」を並べる現在方式を維持する
- frontend の見出し `生成中 X件` はこの値をそのまま使う

これにより、ユーザーが `全セルを実行` したときに、感覚どおり「対象セル数」が表示される。

### 2. Bulk Regeneration Uses Explicit Cell Selection

複数再生成は「自由選択したセル群に対する一括再生成」とする。参照音声ごとの縛りは設けない。

- マトリックスの各セルは従来の `focused` とは別に `selected` 状態を持てる
- 通常クリックで単一選択、修飾クリックなしでもチェック操作で複数選択できる形にする
- 既存の詳細ペイン用 `focused cell` は維持し、最後にクリックしたセルを詳細表示対象にする
- `GenerationConsole` に `選択セルを再生成` ボタンを追加し、選択数を明示する
- backend には複数セル再生成 API を追加し、1 件の job として複数セルを順次処理する

将来的にセルごとの再生成条件が増えても、`selected_cell_ids` を request に載せる形なら拡張しやすい。

### 3. Duplicate Start Guard Exists On Both Frontend And Backend

500 エラーを完全に断定するには追加観測が必要だが、現時点で潰せる明確な危険経路は「同一 project に対する開始リクエストの重複投入」である。

- frontend では generation start 操作専用の `startingJob` フラグを持ち、開始リクエスト送信中のボタン連打を止める
- backend では `project_job_lock` とは別に「開始受付中」も見たうえで、同一 project に対する `generate` / `regenerate` の開始重複を `409 Conflict` で弾く
- 既に走行中の job があること自体は許容する。既存仕様どおり、生成中に再生成を追加できる
- ただし同一セルの再生成多重投入や、同一 `generate_all` の短時間重複開始は拒否する

この層は 500 を隠すためではなく、曖昧な多重開始を明示的なアプリケーションエラーへ変えるためのものと位置づける。

### 4. Logging Is Project-Aware And In-Memory

今回は重い永続ログではなく、まずは調査導線を作る。

- backend に軽量な `AppLogService` を追加し、メモリ上に直近 N 件のイベントを保持する
- 対象イベントは `job_created`, `job_rejected`, `job_started`, `job_completed`, `job_failed`
- 各ログには `timestamp`, `level`, `event`, `project_id`, `job_id`, `message`, `context` を持たせる
- API として `GET /api/logs?project_id=...` を追加する
- frontend はまずグローバルエラー表示にログ ID を混ぜず、必要最小限として `ProjectEditor` 内に簡単なログ表示ブロックを置く

永続化は次段階に回し、まずはユーザーが「何を押した直後に何が起きたか」を共有できる状態を作る。

## Backend Changes

### Generation Progress Aggregate

- `attach_generation_progress()` で `running_job_count` を `sum(job.total_cells for job in running_jobs)` に変更する
- `running_job_kinds` と `active_jobs` の構造は維持する
- 件数の意味が変わるため、既存 API テストを更新する

### Bulk Regeneration Endpoint

新規 endpoint:

- `POST /api/projects/{project_id}/cells/regeneration-jobs`

request:

- `cell_ids: string[]`
- `seed: number | null`

validation:

- 空配列は禁止
- project に存在しない cell は 404
- 重複 cell_id は 400
- 同一セルが既に `queued` / `generating` なら 409

実行:

- `job_registry.create(..., "regenerate_cell", cell_ids)` を再利用する
- worker 内で `cell_ids` を順に `generation_service.regenerate_cell()` へ流す
- `persist_job_state()` と `job_registry.mark_*()` を使って既存の進捗表示に乗せる

### Start Guard

- project ごとの「起動中リクエスト」確認関数を router 内に追加する
- 同一 project で `generate_all/generate_missing` の `running` job があるときは、新しい同系統開始を 409
- 同一 cell を target に含む `regenerate_cell` の `running` job があるときは 409
- 拒否時にはアプリログへ `job_rejected` を残す

### Logging

- `app/services/app_log_service.py` を追加する
- `create_app()` で singleton を組み立て、router に注入する
- 主要分岐で構造化ログを残す

## Frontend Changes

### Selection Model

- `App` の `selectedCellId` は維持しつつ、新しく `selectedCellIds: string[]` を持つ
- `ProjectEditor` / `LineMatrix` に両方を渡す
- セルカードに選択トグル UI を追加する
- セル本文クリックは「focus + 単体選択」、トグル操作は複数選択の追加/解除とする

### Bulk Regeneration Console

- `GenerationConsole` に `選択セルを再生成` ボタンを追加する
- ラベルは `選択セルを再生成 (3)` のように選択件数を出す
- 選択ゼロ時、または全選択セルが再生成不可なら disabled
- 開始時は `startRegenerationBatchJob()` を呼ぶ

### Start Guard UX

- `startJob()` 中でも特に開始系ボタンを止める `startingJob` を別管理する
- `busy` だけではなく `startingJob` でも生成系ボタンと複数再生成ボタンを止める
- backend から 409 が返ったときは、そのままユーザーへ意味のあるメッセージとして表示する

### Log View

- `ProjectEditor` 下部または右レールに簡易ログセクションを追加する
- 最新 20 件程度を表示し、イベント名とメッセージを確認できるようにする
- レイアウト刷新は今回やらず、テキスト中心で十分とする

## Error Handling

- 複数再生成リクエストに一部不正な `cell_id` が含まれる場合、部分成功にせず全体を失敗させる
- 同一セルの多重再生成は 409 で拒否する
- `generate_all` の対象が 0 件なら job は即 `completed` だが、ログには `job_created` を残す
- ログ取得 API の失敗は editor 全体を止めず、ログ欄だけ非表示にする

## Testing Strategy

### Backend

- `generate_all` 実行中の `running_job_count` が対象セル数になること
- `generate_all + regenerate` 併走時に件数が合算されること
- 複数セル再生成 API が選択セルを順に再生成すること
- 同一セルの再生成多重開始が 409 になること
- 開始拒否や失敗がログ API に現れること

### Frontend

- `GenerationConsole` が選択件数つきの複数再生成ボタンを描画すること
- `LineMatrix` で複数セルを選択・解除できること
- 開始中は生成系ボタンが即 disabled になること
- 409 応答時にエラーメッセージが表に出ること
- ログ表示が API 結果を描画できること

## Risks

- `running_job_count` の意味変更により、既存テストや認識とのズレが起きる
- `regenerate_cell` を複数セル job に流用するため、kind 名と意味が少し広がる
- in-memory ログはプロセス再起動で消える

## Recommendation

今回の最適解は、大きな UI 改修を避けつつ、backend に「セル単位の進捗集約」と「明示的な重複起動制御」を持たせ、その上で frontend に最小の複数選択再生成 UI を載せることだ。これにより、ユーザーが困っている「件数が変」「まとめて再生成できない」「押しても不安」「何が起きたか分からない」を一度に薄くできる。
