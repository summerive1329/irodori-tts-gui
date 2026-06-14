# Irodori GUI Iteration Design

## Goal

`Irodori Studio` の MVP を次フェーズへ進め、生成途中の視認性、操作性、書き出し柔軟性、リロード復帰性を高める。今回の主目的は、`line x reference` マトリクスを維持しつつ、自由編集できる export playlist を導入し、セル単位の進捗反映とプレイバック中心の UI を実現することである。

## Scope

### In Scope

- 生成セルの途中更新をフロントエンドへ順次反映する
- `Generate Missing` と `Generate All` を job ベースに整理する
- セル状態を `idle / queued / generating / ready / error` で明示する
- 書き出しを「各行から 1 つ選ぶ方式」から「任意セルを自由順で積む playlist 方式」へ拡張する
- 参照音声カラム単位で、生成済みセルを上から playlist に一括追加できる
- プロジェクトを URL で表現し、リロード後も同じ project を開けるようにする
- 日本語中心の UI にする
- マトリクスのヘッダー整列、行幅改善、再生 UI 改善、レイアウトシフト抑制を行う
- 未再生 / 再生済みを判別できる UI を追加する
- 同一参照音声カラム内での連続自動再生トグルを追加する
- セリフ一覧を txt として書き出せるようにする
- 行順変更をドラッグ&ドロップ対応にする
- 任意の行間へ新しいセリフを挿入できるようにする
- `Regenerate` で他セルが消える不具合を修正する

### Out of Scope

- セルごとの複数履歴 UI
- クラウド同期やマルチユーザー対応
- WebSocket 常時接続
- 音声編集波形 UI
- Electron 化

## Product Direction

今回の画面は「比較と生成」と「最終編集と書き出し」を明確に分離する。

- 生成マトリクス
  - セリフ x 参照音声の比較、再生成、状態確認のための領域
- Export playlist
  - 実際に 1 本の音声へ結合する順序を編集する領域

これにより、MVP の `selected_for_export` 中心設計で生じていた「比較 UI と最終書き出し UI が同じ場所に混ざる」問題を解消する。

## Data Model Changes

### Project

`Project` は既存の `lines / references / cells / export_order` に加えて、`export_playlist` を持つ。

```text
Project
  id
  name
  ...
  lines[]
  references[]
  cells[]
  export_playlist[]
```

### ExportPlaylistItem

playlist の各要素は、セル結果のスナップショット参照ではなく「どのセル結果を並びに含めるか」を表す。

- `id`
- `cell_id`
- `line_id`
- `reference_id`
- `label`
- `created_at`

`label` は UI 表示用の簡易文字列で、初期値は `"{reference_label} / {line_text_preview}"` とする。playlist には同じ `cell_id` を複数回追加してよい。

### Cell

`Cell.selected_for_export` は廃止する。export の責務を playlist 側へ完全に移すためである。

`Cell.status` は次の 5 状態を持つ。

- `idle`
- `queued`
- `generating`
- `ready`
- `error`

`generating` 中も、直前の `current_result` は残す。これにより「再生成中に比較用音声が消える」ことを避ける。

## Routing And Persistence

### Routes

- `/`
  - project 一覧
- `/projects/:projectId`
  - project editor

リロード時は route param から project を再読込する。存在しない project id の場合はホームへ戻し、エラー通知を出す。

### Persistence

`project.json` に `export_playlist` を保存する。playlist は project と同じライフサイクルで永続化される。

`txt` 書き出しは、playlist ではなく「現在のセリフ一覧」を行順どおりに改行区切りで出力する。これは脚本として使いやすく、今回の要求とも素直に一致する。

## Generation And Job Flow

### Job Model

バックエンドは FastAPI プロセス内メモリに軽量 job registry を持つ。外部キューは導入しない。

Job は以下を持つ。

- `id`
- `project_id`
- `kind` (`generate_missing`, `generate_all`, `regenerate_cell`)
- `status` (`running`, `completed`, `failed`)
- `total_cells`
- `completed_cells`
- `target_cell_ids[]`
- `error_message`

### Request Flow

- `Generate Missing`
  - 対象セルを `idle` または未生成セルに限定して job 作成
- `Generate All`
  - すべての対象セルを job に含める
- `Regenerate`
  - 単一セルだけを対象とする job を作る

API は job 作成後すぐ応答し、フロントは project と job をポーリングする。project 側のセル状態が更新されるたび、UI はそのセルだけを描画し直す。

### Cell Update Rules

- `queued`
  - job に積まれ、まだ処理していない
- `generating`
  - 実際に処理中
- `ready`
  - 最新結果を書き戻した
- `error`
  - 対象セルのみ失敗

`Regenerate` は対象セル以外の `current_result` を変更してはならない。これは回帰テストで保証する。

## Export Playlist Behavior

### Manual Add

各セルには `playlist に追加` 操作を持たせる。追加時は playlist 末尾へ 1 件 append する。

### Column Bulk Add

各参照音声カラムヘッダーには `上から追加` 操作を置く。現在のセリフ順に従って、そのカラムの `ready` セルだけを順次 playlist に追加する。

### Playlist Editing

playlist では次を可能にする。

- 要素削除
- ドラッグ&ドロップによる順序変更
- 同一セルの重複保持
- 現在の要素数と合計時間の確認

WAV 書き出しは playlist 順で行う。playlist が空なら export は不可。

## UI Layout

### Overall Structure

- 上部ヘッダ
  - project 名
  - project メニュー
  - txt 書き出し
- 中央上段
  - 操作コンソール帯
- 中央中段
  - 生成マトリクス
- 中央下段または右下段
  - export playlist
- 右ペイン
  - 選択セル詳細

playlist はマトリクスと分けて見せる。比較と最終編集を一つの領域へ押し込まない。

### Console Bar

マトリクス直上に高優先度の操作を集める。

- `Generate Missing`
- `Generate All`
- job 進捗表示
- 自動再生トグル

`Delete Project` はここへ置かない。ヘッダのメニュー内へ移す。

### Matrix Layout

左端に固定のセリフ列を置き、その右に参照音声列を揃える。ヘッダーと本文セルは同じグリッド定義を共有し、ずれをなくす。

セリフ列幅は可変とし、初期幅は現状より広くする。最低でも 2 行程度の日本語セリフが読みやすい幅を確保する。

### Cell UI

各セルには以下を含める。

- 状態バッジ
- 進捗中表示
- 再生 UI
- playlist 追加ボタン
- 再生成ボタン
- 未再生 / 再生済み表示

`audio` の標準コントロールはそのまま使ってよいが、押しやすい余白とタッチ領域を与える。再生バーまわりの密度を下げ、視認性を上げる。

状態文やエラー文の表示領域は固定高とし、`Use` や `Regenerate` 操作後にマトリクス全体が上下へずれないようにする。

### Localization

左上の `Irodori Studio` などプロダクトネーミング以外は日本語を優先する。

例:

- `Generate Missing` -> `未生成を実行`
- `Generate All` -> `全セルを実行`
- `Ready` -> `生成済み`
- `Generating` -> `生成中`

### Playback UX

セルは再生された時点で `played` の UI 状態を持つ。背景色やラベルで未再生と区別する。

自動再生トグルが有効なとき、同一参照音声カラムのセルを上から順に連続再生する。あるカラムの再生が終わっても、他カラムへ自動遷移はしない。

## Line Editing UX

### Reorder

上下ボタン主体ではなく、行そのものをドラッグして離れた位置へ移せるようにする。

### Insert

各行の間に `ここに追加` 操作を置き、指定位置へ新しいセリフを挿入できるようにする。

行の追加・挿入・並び替え後は、表示順と playlist 一括追加順の基準として使う `order_index` を再採番する。

## Error Handling

- 存在しない project route
  - ホームへ戻し、通知を出す
- job 失敗
  - job ステータスを `failed` にし、対象セルのみ `error`
- 再生成失敗
  - 既存 `current_result` は保持したまま `error`
- playlist export 失敗
  - 欠損ファイルやサンプルレート不一致を通知する
- txt export 失敗
  - project 不在や書き込み不能を通知する

## Testing Strategy

### Backend

- job 作成 API が即時応答し、対象セルを `queued` にすること
- job 実行でセル状態が `queued -> generating -> ready/error` と遷移すること
- `Regenerate` が対象セル以外の結果を消さないこと
- playlist へ同一セルを複数回追加できること
- 列一括追加が現在の行順どおりに playlist へ追加すること
- WAV export が playlist 順に連結すること
- txt export が現在のセリフ一覧を改行区切りで返すこと
- route 用 project 読み込みで存在しない id を適切に扱うこと

### Frontend

- route 付き reload で同じ project を再表示できること
- セル状態更新がポーリングで順次反映されること
- 再生成中も直前音声が見えること
- カラム一括追加が playlist を増やすこと
- playlist の並び替えと削除が反映されること
- 行のドラッグ並び替えが離れた位置でも動くこと
- 行間挿入が正しい index へ入ること
- 自動再生トグルが同一カラム内だけで連続再生すること
- 日本語 UI ラベルが主要操作へ反映されること

### End-to-End

- 2 参照音声 x 複数行を生成し、完了セルが途中反映されること
- 一部セルだけ再生成して他セルが保たれること
- 単一セル追加と列一括追加の両方で playlist を構築できること
- playlist 順に WAV を書き出せること
- セリフ一覧 txt を書き出せること
- `/projects/:projectId` の reload 復帰ができること

## Migration Notes

今回の変更は `selected_for_export` 中心設計から playlist 中心設計への移行である。既存 project データに `selected_for_export` が残っていても、読み込み時は無視または移行対象とし、新しい export 動線は `export_playlist` のみを正とする。

将来的にセル履歴を持つ場合も、playlist は `cell_id` ではなく `cell_result_id` を参照する形へ自然に拡張できる。
