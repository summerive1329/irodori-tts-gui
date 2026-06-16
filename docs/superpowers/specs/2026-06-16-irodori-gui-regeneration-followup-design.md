# Irodori GUI Regeneration Follow-up Design

## Goal

前バッチで追加した生成管理まわりを、実運用で違和感が出た点に合わせて磨き直す。今回の対象は次の 4 点である。

- `GENERATION JOB` 件数を「開始時の総数固定」ではなく「未完了セル数」で減算表示する
- 複数セル再生成 UI を常時チェックボックス方式から「選択モード」方式へ切り替える
- アプリログを `logs/` 配下のタイムスタンプ付きファイルへ出力する
- 作業完了後に `docs/communication/demand.md` を整理し、対応済み項目を明示する

## Scope

### In Scope

- backend の progress 集約ロジックの再定義
- frontend の複数選択 UI 変更
- backend のファイルログ出力
- `demand.md` の整理

### Out of Scope

- レイアウト固定、独立スクロール、ヘッダー固定
- 行の差し込み移動 UI
- 削除取り消しタイマーの可視化
- 音声プレイヤーそのもののデザイン刷新
- BSOD の原因特定そのもの

## Problem Summary

前回の実装で「複数選択して再生成できる」「ログ API がある」までは到達したが、実際の操作感と観測性にはまだギャップが残っている。

- `running_job_count` は `sum(job.total_cells)` ベースにしたため、生成開始直後の総件数は見えるが、処理が進んでも減らない
- 複数選択 UI は技術的には動くが、各セルに常時チェックボックスが出ているため比較作業のノイズになる
- ログは API では見えるが、ユーザーから見ると「どこに残るのか」が分かりにくい

今回の修正では、件数を「残り件数」、複数選択を「明示的な選択モード」、ログを「ファイルとして見えるもの」へ揃える。

## Design Direction

### 1. Running Count Means Remaining Target Cells

`generation_progress.running_job_count` は「走行中 job が抱えている未完了セル数」の合計にする。

- 各 job の寄与値は `job.total_cells - job.completed_cells`
- 0 以下にはしない
- `generate_all` や bulk regenerate は、完了セルごとに 1 件ずつ減る
- `active_jobs` は代表セル表示のまま維持する

これで `生成中 5件` が `4件`, `3件` と自然に減っていく。

### 2. Bulk Regeneration Uses Explicit Selection Mode

複数セル再生成は通常時に選択 UI を露出し続けず、明示的なモード切り替えで扱う。

- `GenerationConsole` に `複数選択で再生成` ボタンを置く
- 押すと `selection mode` に入る
- 選択モード中はセル本体クリックで対象を追加/解除する
- 音声の再生ボタン、シークバー、個別再生成ボタンなどの内部コントロールはそのまま使える
- 選択済み件数を console 側に表示し、`実行` / `キャンセル` を出す
- 通常時のセルクリックは従来どおり focus 用に残す

これにより、普段は画面が静かで、必要なときだけ複数選択へ入れる。

### 3. Logging Becomes Visible On Disk

前回の `AppLogService` は残しつつ、同じイベントをファイルにも書く。

- リポジトリ直下に `logs/` ディレクトリを使う
- backend 起動時に `logs/app-YYYYMMDD-HHMMSS.log` を作る
- 主要イベント:
  - `job_created`
  - `job_rejected`
  - `job_started`
  - `job_completed`
  - `job_failed`
- 1 行 1 レコードのテキストログで十分
- API 表示は継続し、ファイルログは観測経路の追加として扱う

ユーザーは GUI 上の簡易ログも見られ、必要なら `logs/` を直接共有できる。

## Backend Changes

### Progress Aggregate

`attach_generation_progress()` で:

- `running_job_count = sum(max(job.total_cells - job.completed_cells, 0) for job in running_jobs)`

へ変更する。

### File Logging

`AppLogService` にファイル出力を追加する。

- constructor で出力先パスを受け取る
- `create_app()` が `logs/` を作ってセッションログファイルパスを渡す
- `log()` 呼び出し時にメモリ保存とファイル追記の両方を行う

## Frontend Changes

### Selection Mode State

`App` に次を追加する。

- `selectionMode: boolean`
- `selectedCellIds: string[]`

状態遷移:

- モード開始: 選択配列を空にして `true`
- セルクリック: 選択対象を toggle
- 実行完了 or cancel: モード終了、選択クリア

### Generation Console

通常時:

- `未生成を実行`
- `全セルを実行`
- `複数選択で再生成`

選択モード時:

- `選択セルを再生成 (n)`
- `キャンセル`
- 補助文言 `セルをクリックして選択`

### Line Matrix

- 選択モード中のみ、セル本体クリックを selection toggle にする
- 通常時は従来どおり focus
- 内部の button / audio / input では `stopPropagation` を維持して、選択誤爆を防ぐ
- 選択中セルは既存の `is-selected` クラスで強調表示する

## Error Handling

- 選択モードで 0 件のまま `実行` は disabled
- backend 409 が返ったら、エラー表示に加えてログも再取得する
- ログファイル書き込みに失敗しても API 自体は落とさず、メモリログだけ残す

## Testing Strategy

### Backend

- `running_job_count` が完了件数に応じて減ること
- ログサービスがファイルを生成し、イベントを書き出すこと

### Frontend

- 選択モードに入る前はチェック UI が見えないこと
- 選択モード中はセルクリックで選択数が増減すること
- audio や個別ボタンの操作で selection toggle が暴発しないこと
- 実行後または cancel で selection mode が閉じること

## Recommendation

今回は「見た目を大きく変えず、今ある生成管理を実用寄りに詰める」ことが目的なので、backend では件数の意味とログ出力先を修正し、frontend では常時表示 UI をやめてモード式へ寄せるのが最も素直で安全である。
