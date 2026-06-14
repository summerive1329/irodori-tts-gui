# Irodori GUI Status Model Design

## Goal

`Irodori Studio` の既存不具合のうち、状態表示の分かりにくさと進捗表示の破綻を解消する。今回の対象は次の 3 点である。

- `GENERATION JOB` が追加再生成で `0/1` のように崩れる問題
- 再生成後もセルが `再生済み` のまま残る問題
- `未生成` と `未再生` が曖昧で、セル状態表示が理解しづらい問題

## Scope

### In Scope

- project 単位の generation progress 集約モデルを backend で定義する
- `GENERATION JOB` 表示を `n/m` から `running job 数` ベースへ変更する
- セルの表示状態を `未生成 / 生成中 / 未再生 / 再生済み / エラー` に再定義する
- `未再生` マークをセル左上の状態表示へ統合する
- 再生成成功後にセルを即 `未再生` 扱いへ戻す

### Out of Scope

- 複数選択再生成 UI
- drag and drop の改善
- 固定レイアウトやスクロール分離
- 書き出しリストやセリフの一括クリア
- テーマ全体の再配色

## Problem Summary

現在の UI は、backend の生成状態と frontend の再生状態が別々に解釈されているため、ユーザーが見る「いま何が起きているか」が不明確になっている。

- `GENERATION JOB` は job ごとの表示をそのまま出しており、途中で再生成を追加すると主表示が小さい `0/1` に乗り換わってしまう
- セルは `ready` を「生成済み」の意味で持っているが、`未再生` と `再生済み` の区別は別実装になっており、再生成後に表示が追従しない
- 初期状態が `待機中` に見える場面があり、`未生成` と認識しづらい

今回の修正では、UI が必要とする状態を backend / API 層で明示し、frontend はそれを素直に描画する構成へ寄せる。

## Design Direction

### 1. Generation Progress Is Project-Scoped

`GENERATION JOB` は個別 job の進捗をそのまま見せるのではなく、project 単位の集約 progress を表示する。

- 集約対象は `running` の job のみ
- 主表示は `生成中 3件` のような `running job 数`
- `n/m` は廃止する
- 補助表示が必要なら `active job kind` や `active cell count` を後から足せる形にするが、今回の主仕様には含めない

これにより、`Generate All` 実行中に個別 `Regenerate` を追加しても、表示の主語がぶれなくなる。

### 2. UI Cell State Is Redefined

既存の `idle / queued / generating / ready / error` をそのまま UI ラベルに流すのではなく、UI 用のセル状態を明示的に再定義する。

- `未生成`
  - 音声ファイルがまだ存在しない
  - 表示色はグレー
- `生成中`
  - 生成 job または再生成 job に含まれており、まだ完了していない
  - 表示色はブルー
- `未再生`
  - 最新の音声ファイルが存在し、まだ再生されていない
  - 表示色はオレンジ
- `再生済み`
  - 最新の音声ファイルが生成済みで、少なくとも 1 回再生された
  - 表示色はグリーン
- `エラー`
  - 生成失敗時の最優先状態
  - 表示色はレッド

`未生成` と `未再生` は明確に分離し、「音声がないのに未再生扱い」という状態を禁止する。

### 3. Playback State Becomes Part Of The Main Status Slot

現在の左下ラベル方式はやめ、再生状態を左上のステータスマークへ統合する。

- 左下の `未再生 / 再生済み` ラベルは廃止する
- 左上の状態テキストと状態色が単一の真実になる
- `未再生` はオレンジ、`再生済み` はグリーンで区別する
- `エラー` は他状態を上書きする

これにより、ユーザーはセルごとに 1 つの状態表示だけ見ればよくなる。

## Backend / API Changes

### Project Progress Aggregate

project 詳細 API のレスポンスに、project 単位の progress 集約情報を追加する。

想定プロパティの例:

- `running_job_count`
- `running_job_kinds`
- `has_running_jobs`

重要なのは、frontend が個別 job 配列を数え直して表示モデルを組み立てないことだ。集約の基準は backend が持つ。

### Cell Presentation State

API レスポンスの各 cell に、UI が直接使える状態フィールドを追加する。

候補:

- 既存 `status` を置き換えるのではなく、表示用の `display_status` を追加する
- または API schema 上の `status` 自体を UI 向け語彙へ寄せる

今回のおすすめは `display_status` の追加である。既存の内部実装やテストの影響を局所化しやすく、backend 内部状態の意味を無理に変えずに済むため。

`display_status` は最終的に次を返す。

- `not_generated`
- `generating`
- `unplayed`
- `played`
- `error`

## Frontend Changes

### Generation Console

`GenerationConsole` は個別 job snapshot 依存を弱め、project 集約 progress を主表示に使う。

- `GENERATION JOB` の本文は `生成中 X件` を主表示にする
- `running_job_count === 0` のときは待機表示に戻す
- 追加再生成が走っても、主表示は集約件数だけを見て変化する

### Line Matrix Cell Status

`LineMatrix` のセル上部表示は `display_status` をそのまま描画する。

- `未生成`: グレー
- `生成中`: ブルー
- `未再生`: オレンジ
- `再生済み`: グリーン
- `エラー`: レッド

左下の再生状態スロットは削除する。

### Playback State Reset

再生成成功時は、対象セルの `display_status` を即 `未再生` に戻す。

- フロントだけの一時状態ではなく、API レスポンスに基づいて更新する
- リロードしなくても状態が一致する

## State Transitions

セル表示状態の遷移は次で固定する。

- 初期作成直後: `未生成`
- 生成開始: `生成中`
- 生成成功: `未再生`
- 再生開始または完了後: `再生済み`
- 再生成開始: `生成中`
- 再生成成功: `未再生`
- 生成失敗: `エラー`

この遷移により、`再生成後も再生済みのまま` という不整合を防ぐ。

## Error Handling

- job 集約情報の算出に失敗した場合
  - project 詳細 API 全体を失敗させず、既存 project 情報を優先して返す構造が望ましい
- `display_status` の解決不能状態
  - `error` にフォールバックせず、内部状態と再生情報の組み合わせを明示的に網羅する
- 再生成直後の一時揺れ
  - polling 中に古い project を描かないよう、既存の job polling 安定化方針を維持する

## Testing Strategy

### Backend

- project progress 集約が `running` job だけを数えること
- `Generate All` 中に `Regenerate` を追加しても件数表示用集約が崩れないこと
- cell の `display_status` が `未生成 -> 生成中 -> 未再生 -> 再生済み` を正しく辿ること
- 再生成成功後に `display_status == unplayed` へ戻ること

### Frontend

- `GenerationConsole` が `n/m` ではなく `生成中 X件` を表示すること
- 追加再生成時も主表示が `0/1` に置き換わらないこと
- `LineMatrix` が左上状態表示だけで `未生成 / 生成中 / 未再生 / 再生済み / エラー` を描き分けること
- 左下ラベルが消えていること

## Risks

- backend の内部状態と UI 状態の二重管理が増える
  - `display_status` を導入する場合、算出ロジックを 1 箇所へ閉じ込める必要がある
- 既存テストが `ready` 前提で書かれている箇所に波及する
  - 内部状態は維持し、表示状態だけ追加する方が安全
- 将来の複数選択再生成に progress 集約仕様が影響する
  - 今回の「running job 数」モデルは拡張しやすい

## Recommendation

今回の修正では、backend で次を行うのが最適である。

- project 単位の `running job` 集約情報を返す
- cell ごとに UI 向け `display_status` を返す

そのうえで frontend は、個別 job の見た目調整ではなく、backend が返した集約状態と表示状態をそのまま描画する。これが最もぶれにくく、今回の不具合 3 点を同時に解決しやすい。
