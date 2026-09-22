# 認識モデルの作り直し（開発者向け）

`index.html` に埋め込んである CNN の重み（`CNN_MODEL`）を作り直すための一式です。
アプリを使うだけなら、ここを触る必要はありません。

## 必要なもの

```
pip install torch numpy pillow
```

日本語フォントが入っていること（IPAGothic など。`fc-list :lang=ja` で確認）。

## 手順

```bash
# 1. 筆画テンプレートを index.html から取り出す（templates.json を更新するとき）
node -e "const fs=require('fs'),vm=require('vm');
  const H=fs.readFileSync('../index.html','utf8');
  const sb={};vm.createContext(sb);
  vm.runInContext(H.match(/\/\* ==RECOGNIZER-BEGIN==[\s\S]*?\/\* ==RECOGNIZER-END== \*\//)[0]+';globalThis.R=Recog;',sb);
  fs.writeFileSync('templates.json',JSON.stringify(sb.R._raw));"

# 2. 学習データを作る（筆画テンプレートを崩した手書き風＋フォント字形。約2分、data.npz 約46MB）
python3 gen.py templates.json

# 3. 学習する（CPU で約12分）
python3 train.py

# 4. int8量子化して base64 で書き出す（model_b64.json 約67KB）
python3 export_b64.py

# 5. index.html の CNN-MODEL ブロックの中身を model_b64.json で置き換える
```

## 中身

| ファイル | 役割 |
| --- | --- |
| `gen.py` | 学習データ生成。筆画を回転・伸縮・傾き・手のふるえ・書き始め終わりの欠けで崩し、線の太さを変えて 48x48 に描く。フォント字形も混ぜる |
| `train.py` | 3x3畳み込み×4 → 全体平均 → 全結合（約5万パラメータ）の学習。BatchNorm は書き出し時に畳み込みへ畳み込む |
| `export_b64.py` | int8量子化 → base64 で `model_b64.json` を書き出す |
| `templates.json` | 筆画テンプレート（`index.html` から取り出したもの） |

`data.npz` `model.pt` `model.json` は大きいのでリポジトリには入れていません。

## 検証

書き出したあとは必ず実行してください。

```bash
node ../test/recognize.test.js 40 1.0     # 認識エンジン（CNN込み）
node ../test/e2e.test.js                  # 画面の通しテスト（要 Playwright）
```
