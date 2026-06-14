# Irodori GUI Polish Design

## Goal

`Irodori Studio` の MVP で見つかった不具合と操作上の弱さを整理し、生成ワークフローを止めずに使い続けられる状態へ引き上げる。今回の主目的は、ジョブ進行中の UI 安定性、マトリクス編集の信頼性、実行ボタンや再生操作の分かりやすさを改善することである。

## Scope

### In Scope

- `Generate Missing` と `Generate All` の挙動差をなくし、どちらも初回から確実に動かす
- ジョブ進行中のポーリング停止に対して、フロントエンドがより粘り強く復旧できるようにする
- 生成中でも既生成セルの `Regenerate` だけは追加キューできるようにする
- route reload 時のホーム画面ちらつきを減らす
- マトリクスのヘッダと 1 行目の整列崩れを解消する
- カラム単位の playlist 一括追加 UI を見つけやすくし、機能と表示を一致させる
- 行ドラッグ並び替えを全行で確実に機能させる
- 再生済み表示によるレイアウトシフトをなくす
- 行削除を `undo` 付きにして誤操作の救済を入れる
- セリフ列幅をユーザーが調整できるようにする
- 音声再生 UI の押しやすさと視認性を改善する
- スタート画面を英語へ戻し、エディタ本体は日本語中心を維持する
- テーマカラー、未再生 / 再生済み配色、実行ボタンの強弱、プロジェクト削除導線を見直す

### Out of Scope

- セル履歴の複数保持 UI
- WebSocket 化
- オーディオ波形編集
- playlist 構造の全面刷新
- バックエンドの外部ジョブキュー導入

## Product Direction

今回の polish は新しい操作モデルを増やすよりも、既存の `matrix + playlist + detail pane` 構成を信頼できる道具へ整えることを優先する。

- 実行系
  - ユーザーが押した操作に対して確実に反応し、進行中か失敗かを分かりやすく返す
- 比較系
  - 参照音声カラムと各セリフ行の対応が常に視覚的に崩れない
- 編集系
  - 並び替え、削除、再生成が意図せず壊れず、誤操作しても救える
- 仕上げ系
  - 配色、文言、ボタンの優先度が自然で、長時間使っても疲れにくい

## Problem Summary

今回の `demand.md` で挙がった論点は、大きく 3 系統に分かれる。

1. 状態管理とジョブ進行の不安定さ
2. マトリクス DOM / レイアウト由来の操作不良
3. 配色や露出度のチューニング不足

これらを同時に大改修すると原因切り分けが難しくなるため、実装は次の順で進める。

1. 状態管理と実行フローの安定化
2. マトリクスと編集操作の修正
3. 見た目と文言の再調整

## Architecture

### Frontend State Split

現在の `busy` は「単発 API mutation 中」と「長時間の generation job 進行中」を一緒に表している。このままだと、押せるべき操作まで一律停止したり、逆に止めるべき操作が開いてしまう。

今回の polish ではフロントエンド上の制御概念を以下へ分ける。

- `isMutating`
  - 行編集、playlist 更新、参照音声追加など短い API 操作
- `activeJob`
  - `generate_missing` / `generate_all` / `regenerate_cell` の進行状態
- `jobPollingState`
  - polling 中 / retry 中 / 停止 を把握する軽量状態

UI の disable 判定は「何を止めるか」で切り分ける。

- 止める操作
  - 行追加
  - 行削除
  - 行並び替え
  - 行本文編集
  - カラム一括追加
  - playlist 編集
- 止めない操作
  - 既存音声の再生
  - セル選択
  - 既生成セルの `Regenerate`
  - `Generate Missing` / `Generate All` の押下可否表示

### Regenerate Queueing Rule

生成中でも個別セルの `Regenerate` は許可する。これは今回の明示要求であり、比較作業のテンポを損なわないために重要である。

ただし自由編集まで同時に開けると、行削除や並び替えで対象セル参照が揺れるリスクがある。したがって構造変更系の操作は止めたまま、セル単位の再生成のみ例外的に許可する。

### Polling Resilience

`useProjectJobs` は現在 1 回の失敗で polling を止めている。これが一時的な通信エラーや fetch 競合で UI 更新停止に見える原因になる。

新しい挙動は以下とする。

- `running` job 中に 1 回失敗しても即停止しない
- 短い backoff を付けて再試行する
- 一定回数を超えて失敗したときだけエラーを表示し、job 側状態を不明扱いにする
- retry 中も既存 project 表示は保持する

これにより「進行中のジョブが UI から消える」体験を減らす。

### Route Reload Experience

`/projects/:projectId` を直開きした際、project fetch 完了前にホーム相当 UI が一瞬見えるのが邪魔になっている。これは `project === null` をただちにホーム表示へ結びつけているためである。

今後は route 付きロード中に専用の loading shell を返し、`projectId` がある間はホーム UI を出さない。404 のときだけホームへ戻す。

## Matrix Layout And Interaction Design

### Grid Contract

`LineMatrix` は、ヘッダ行・挿入スロット・本文行がそれぞれ別レイアウトで流れているため、1 行目のヘッダ対応や drag target 計算がずれやすい。

これを次のグリッド契約へ揃える。

- 1 列目
  - 可変幅の dialogue column
- 2 列目以降
  - 各 reference に対応する固定幅セル列

ヘッダ、各本文行、挿入スロットのすべてが同じ列定義を共有する。これにより「左上 corner」「参照音声 header」「本文セル」が常に同じ軸で並ぶ。

### Column Bulk Add

カラム全体を playlist に追加する UI は、機能自体はあるが見失われやすく、要件上の「実装されていない」に近い知覚になっている。

対策として次を行う。

- 各参照音声ヘッダに明示的な action button を固定配置する
- 文言は `上からリスト追加` のように playlist への影響が分かるものへ寄せる
- disabled 状態では見た目でも押せないことを明確にする

### Drag Reorder

現状は 1 行目だけ動いて見えるケースがあり、drop slot の高さと hit area が足りないこと、drag target 管理がスロット単位で安定していないことが原因候補である。

新しい並び替えは次の前提で組む。

- 各行に一貫した drag handle を持つ
- 各行の前後に十分な高さの drop slot を置く
- drag 中の hover index を明示的に state で持つ
- 2 行目以降でも同じイベントで反応することを test で保証する

### Played / Unplayed Indicator

`再生済み` ラベルを疑似要素で後付けしているため、セルの高さや下端ボタン位置が環境によってぶれやすい。

今後は再生状態専用の固定 slot をセル内部に持つ。

- 未再生
  - 緑寄りで目立つ
- 再生済み
  - 落ち着いたトーン

この slot は常に場所を確保し、再生成ボタンや audio control を押し下げない。

## Deletion Safety

行削除は即時反映を保ちつつ、数秒の `undo` を出す。確認ダイアログは作業リズムを止めるため採用しない。

挙動は次の通り。

- 削除直後に UI から行を消す
- 画面下部の toast に `元に戻す` を出す
- 一定時間内に undo されたら line を元位置へ戻す
- 時間切れで確定したら削除 API を commit する

削除確定までは backend を呼ばず、frontend で一時的に非表示化する。これにより復元 API は不要とし、既存 backend 契約を増やさずに済ませる。

これにより誤タップからの回復余地を確保しつつ、通常操作のテンポは保つ。

## Visual Refresh

### Language Split

- スタート画面
  - 英語へ戻す
- エディタ本体
  - 日本語中心を維持する
- プロダクト名
  - `Irodori Studio` のまま維持する

### Color Direction

現在の薄黄色は温度感が中途半端で、作業アプリとしての落ち着きよりも曖昧さが勝っている。新配色は「ナチュラル寄りの紙色 + 深い緑 + 控えめな琥珀」をベースにする。

- 背景
  - もう少しニュートラル寄り
- 強調
  - 深いグリーン
- 実行系
  - 目立つアクセント
- 危険操作
  - メニュー階層へ退避しつつ赤系を維持

### Execution Buttons

`未生成を実行` と `全セルを実行` はどちらも主操作に近いため、今より明快な重み付けを与える。

- `未生成を実行`
  - 第一優先の primary
- `全セルを実行`
  - 第二優先だが十分目立つ accent
- disabled
  - 色と opacity で一目で分かるようにする

### Delete Project Placement

`Delete Project` はヘッダ右上の常設ボタンから外し、`settings` か `project menu` 配下へ移す。危険操作は露出を減らすが、深く隠しすぎない。

## Audio Control UX

セル内 audio は標準コントロールを維持しつつ、次を調整する。

- セル内余白を広げる
- audio 自体の高さを増やす
- 再生部分の上下余白を確保する
- detail pane 側も同じトーンで扱いやすくする

これにより小さく押しづらい印象を減らす。

## Data Persistence

### Column Width

セリフ列幅は frontend 側の local persistence とし、project data へは保存しない。理由は次の通り。

- 個人ごとの表示好みに近い
- 共有対象の project 構造へ混ぜる必要が薄い
- 実装と移行コストを増やさずに済む

保存先は `localStorage` で十分である。

### Pending Delete Undo

undo 中の一時状態も frontend ローカルだけで扱う。ページ再読み込み時は保証しない。これは短時間の誤操作救済が目的であり、永続履歴機構ではないためである。

## Error Handling

- polling retry 超過
  - 既存 project 表示を残したまま、job 更新停止を通知する
- regenerate enqueue 失敗
  - 対象セルのみエラー表示し、他セル表示は保持する
- undo 期限切れ後の削除 API 失敗
  - 行を復元し、通知を出す
- route reload 中の project fetch 失敗
  - 404 はホームへ戻す
  - それ以外は loading shell から error 表示へ移る

## Testing Strategy

### Frontend

- `Generate All` が初回から start job できること
- 生成中でも `Regenerate` が押せて job を開始できること
- polling が一時失敗後に再試行すること
- route reload 中にホーム UI を一瞬描画しないこと
- matrix header と 1 行目セルが同じ列定義で並ぶこと
- カラム一括追加ボタンが視認でき、押下時に playlist 追加 API が呼ばれること
- 2 行目以降の drag reorder が動くこと
- played / unplayed 表示で再生成ボタン位置が変わらないこと
- 行削除後に undo できること
- dialogue column 幅変更が localStorage へ保存されること

### Backend

- 追加キューされた `regenerate` job が既存 job 進行中でも受理されること

### Manual Smoke

- 2 参照音声で `Generate All` を最初に押して生成が始まること
- 生成途中で特定セルだけ `Regenerate` を足せること
- 一時的な通信不良後も進捗更新が戻ること
- カラム一括追加がヘッダから迷わず見つかること
- 行削除後の `元に戻す` が機能すること
- スタート画面とエディタで文言トーンが意図通り分かれること

## Implementation Order

1. 状態管理と job polling の安定化
2. generate / regenerate の押下制御修正
3. matrix grid と drag reorder の修正
4. 行削除 undo とカラム幅可変
5. 音声 UI と配色、文言、メニュー露出の polish

## Migration Notes

今回の変更は project schema の大きな移行を伴わない。主な追加状態は frontend ローカルで閉じる。

- dialogue column 幅
  - localStorage
- pending line delete undo
  - memory only
- retrying poll state
  - memory only

そのため既存 project data の互換性は維持される。
