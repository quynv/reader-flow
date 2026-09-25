import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from messages import M
for i, loc in enumerate(['en','vi','ja']):
    d = {k: {"message": v[i]} for k, v in M.items()}
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'reader-flow', '_locales', loc)
    os.makedirs(out, exist_ok=True)
    json.dump(d, open(os.path.join(out, 'messages.json'),'w'), ensure_ascii=False, indent=2)
print(len(M), 'keys')
