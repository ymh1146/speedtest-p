import json
import os
from app.config import MAX_REC, REC_F

def sav_rec(rec):
    try:
        recs = []
        if os.path.exists(REC_F):
            try:
                with open(REC_F, 'r', encoding='utf-8') as f:
                    recs = json.load(f)
            except:
                pass

        recs.insert(0, rec)
        recs = recs[:MAX_REC]
        
        with open(REC_F, 'w', encoding='utf-8') as f:
            json.dump(recs, f, ensure_ascii=False, indent=2)
            
    except Exception as e:
        print(f"保存记录失败: {e}")

def ld_recs():
    try:
        if os.path.exists(REC_F):
            with open(REC_F, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"加载记录失败: {e}")
    return [] 