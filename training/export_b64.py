import base64, json, numpy as np, torch
from train import Net, NC, CLASSES, SIZE, fold_bn, evaluate, Xva_t, Yva_t, load_spec_model

m = Net(NC); m.load_state_dict(torch.load("model.pt")); m.eval()
layers = []
for conv, bn in [(m.c1,m.b1),(m.c2,m.b2),(m.c3,m.b3),(m.c4,m.b4)]:
    w,b = fold_bn(conv,bn); layers.append((w.numpy(), b.numpy()))
fw = m.fc.weight.detach().numpy(); fb = m.fc.bias.detach().numpy()

def q(a):
    s = float(np.abs(a).max())/127.0
    qa = np.clip(np.round(a/s), -127, 127).astype(np.int8)
    return base64.b64encode(qa.tobytes()).decode(), s

spec = {"size": SIZE, "classes": CLASSES, "layers": []}
for w,b in layers:
    e,s = q(w)
    spec["layers"].append({"type":"conv","shape":list(w.shape),"scale":round(s,9),
                           "w":e,"b":[round(float(x),5) for x in b]})
e,s = q(fw)
spec["layers"].append({"type":"dense","shape":list(fw.shape),"scale":round(s,9),
                       "w":e,"b":[round(float(x),5) for x in fb]})
js = json.dumps(spec, ensure_ascii=False, separators=(",",":"))
open("model_b64.json","w").write(js)
print(f"model_b64.json {len(js)/1024:.0f} KB")
