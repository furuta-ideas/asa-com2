"""Asa-Com2 手書き認識CNNの学習と書き出し
   小さなCNN（BNは書き出し時に畳み込みへ畳み込む）→ int8量子化 → JSONで出力。
   アプリ側は外部ライブラリ無しでこの重みを読んで推論する。
"""
import json, math, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

torch.manual_seed(0)
np.random.seed(0)
SIZE = 48

d = np.load("data.npz", allow_pickle=True)
Xtr, Ytr, Xva, Yva = d["Xtr"], d["Ytr"], d["Xva"], d["Yva"]
CLASSES = [str(c) for c in d["classes"]]
NC = len(CLASSES)
print("train", Xtr.shape, "val", Xva.shape, "classes", NC)


def prep(X):
    # 白(255)=紙, 黒(0)=線 → 線が1.0 になるように反転して 0..1
    return torch.from_numpy((255 - X).astype(np.float32) / 255.0).unsqueeze(1)


Xtr_t, Ytr_t = prep(Xtr), torch.from_numpy(Ytr)
Xva_t, Yva_t = prep(Xva), torch.from_numpy(Yva)


class Net(nn.Module):
    def __init__(self, nc):
        super().__init__()
        self.c1 = nn.Conv2d(1, 16, 3, padding=1);  self.b1 = nn.BatchNorm2d(16)
        self.c2 = nn.Conv2d(16, 32, 3, padding=1); self.b2 = nn.BatchNorm2d(32)
        self.c3 = nn.Conv2d(32, 48, 3, padding=1); self.b3 = nn.BatchNorm2d(48)
        self.c4 = nn.Conv2d(48, 64, 3, padding=1); self.b4 = nn.BatchNorm2d(64)
        self.fc = nn.Linear(64, nc)

    def forward(self, x):
        x = F.max_pool2d(F.relu(self.b1(self.c1(x))), 2)   # 48→24
        x = F.max_pool2d(F.relu(self.b2(self.c2(x))), 2)   # 24→12
        x = F.max_pool2d(F.relu(self.b3(self.c3(x))), 2)   # 12→6
        x = F.relu(self.b4(self.c4(x)))                    # 6x6x64
        x = x.mean(dim=(2, 3))                             # global average pooling
        return self.fc(x)


def evaluate(model, X, Y, bs=512):
    model.eval()
    ok = top3 = 0
    with torch.no_grad():
        for i in range(0, len(X), bs):
            out = model(X[i:i + bs])
            p = out.argmax(1)
            ok += (p == Y[i:i + bs]).sum().item()
            t3 = out.topk(3, dim=1).indices
            top3 += (t3 == Y[i:i + bs, None]).any(1).sum().item()
    return ok / len(X), top3 / len(X)


def train(epochs=18, bs=256, lr=3e-3):
    model = Net(NC)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=lr, total_steps=epochs * math.ceil(len(Xtr_t) / bs))
    for ep in range(epochs):
        model.train()
        perm = torch.randperm(len(Xtr_t))
        tot = 0.0
        t0 = time.time()
        for i in range(0, len(perm), bs):
            idx = perm[i:i + bs]
            xb, yb = Xtr_t[idx], Ytr_t[idx]
            # 画素ごとのノイズと、線の濃さのばらつき
            xb = xb * (0.75 + 0.5 * torch.rand(len(xb), 1, 1, 1))
            xb = (xb + 0.04 * torch.randn_like(xb)).clamp(0, 1)
            opt.zero_grad()
            loss = F.cross_entropy(model(xb), yb, label_smoothing=0.05)
            loss.backward(); opt.step(); sched.step()
            tot += loss.item() * len(idx)
        a1, a3 = evaluate(model, Xva_t, Yva_t)
        print(f"  epoch {ep+1:2d}  loss {tot/len(perm):.3f}  val top1 {a1*100:.2f}%  top3 {a3*100:.2f}%  ({time.time()-t0:.0f}s)")
    return model


def fold_bn(conv, bn):
    """BatchNorm を畳み込みの重みに畳み込む（JS側の推論を単純にするため）"""
    w = conv.weight.detach().clone()
    b = conv.bias.detach().clone() if conv.bias is not None else torch.zeros(w.shape[0])
    g, be = bn.weight.detach(), bn.bias.detach()
    m, v = bn.running_mean.detach(), bn.running_var.detach()
    s = g / torch.sqrt(v + bn.eps)
    return w * s.view(-1, 1, 1, 1), (b - m) * s + be


def export(model, path="model.json"):
    model.eval()
    layers = []
    for conv, bn in [(model.c1, model.b1), (model.c2, model.b2), (model.c3, model.b3), (model.c4, model.b4)]:
        w, b = fold_bn(conv, bn)
        layers.append((w.numpy(), b.numpy()))
    fw, fb = model.fc.weight.detach().numpy(), model.fc.bias.detach().numpy()

    def q(a):
        s = float(np.abs(a).max()) / 127.0 or 1e-8
        qa = np.clip(np.round(a / s), -127, 127).astype(np.int8)
        return qa, s

    out = {"size": SIZE, "classes": CLASSES, "layers": []}
    for w, b in layers:
        qw, s = q(w)
        out["layers"].append({
            "type": "conv", "shape": list(w.shape), "scale": s,
            "w": ",".join(map(str, qw.reshape(-1).tolist())),
            "b": [round(float(x), 6) for x in b],
        })
    qw, s = q(fw)
    out["layers"].append({
        "type": "dense", "shape": list(fw.shape), "scale": s,
        "w": ",".join(map(str, qw.reshape(-1).tolist())),
        "b": [round(float(x), 6) for x in fb],
    })
    json.dump(out, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    n = sum(np.prod(w.shape) for w, _ in layers) + fw.size
    print(f"  パラメータ {int(n):,} 個 / model.json {len(open(path).read())/1024:.0f} KB")
    return out


def load_spec_model(spec):
    """書き出した int8 の重みから、同じ計算をするモデルを組み直す（JS側と同じ手順の確認用）"""
    m = Net(NC)
    def W(L):
        a = np.array(list(map(int, L["w"].split(","))), dtype=np.float32) * L["scale"]
        return torch.from_numpy(a.reshape(L["shape"]))
    for conv, L in zip([m.c1, m.c2, m.c3, m.c4], spec["layers"][:4]):
        conv.weight.data = W(L)
        conv.bias.data = torch.tensor(L["b"], dtype=torch.float32)
    L = spec["layers"][4]
    m.fc.weight.data = W(L)
    m.fc.bias.data = torch.tensor(L["b"], dtype=torch.float32)
    for bn in [m.b1, m.b2, m.b3, m.b4]:          # BNは畳み込み済みなので素通しにする
        bn.weight.data.fill_(1); bn.bias.data.zero_()
        bn.running_mean.zero_(); bn.running_var.fill_(1); bn.eps = 0
    m.eval()
    return m


if __name__ == "__main__":
    model = train()
    a1, a3 = evaluate(model, Xva_t, Yva_t)
    print(f"検証（float）top1 {a1*100:.2f}%  top3 {a3*100:.2f}%")
    spec = export(model)
    qm = load_spec_model(spec)
    qa1, qa3 = evaluate(qm, Xva_t, Yva_t)
    print(f"検証（int8量子化後）top1 {qa1*100:.2f}%  top3 {qa3*100:.2f}%")
    torch.save(model.state_dict(), "model.pt")
