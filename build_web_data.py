# -*- coding: utf-8 -*-
"""
将 HBase 导出的 JSONL（data/hbase_export.jsonl）整理为前端可直接加载的紧凑数据结构。
所有 78,018 条记录全部保留，不做抽样或截断。

既可被 web/server.py 在内存中直接调用，也可独立运行生成 web/data/restaurants_compact.json。
"""
from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATA_DIR = BASE / "data"
WEB_DATA_DIR = Path(__file__).resolve().parent / "data"

JSONL_PATH = DATA_DIR / "hbase_export.jsonl"
CSV_PATH = DATA_DIR / "clean_restaurant.csv"
DIST_CODE_PATH = DATA_DIR / "district_code.csv"
CAT_CODE_PATH = DATA_DIR / "category_code.csv"
OUT_PATH = WEB_DATA_DIR / "restaurants_compact.json"

PRICE_LEVELS = ["未知", "平价", "中档", "偏高档", "高档", "奢华"]

# 来自 report/数据来源与复算索引.md 与公开地标核对的 5 处验证地标（统一为 WGS-84 坐标）
LANDMARKS = [
    {
        "id": "jiangyang",
        "name": "江杨水产市场片区",
        "district": "宝山区",
        "category": "海鲜",
        "radius_km": 5.0,
        "lng": 121.44766,
        "lat": 31.35545,
        "desc": "宝山海鲜供应链参照点（5 km 圈内海鲜占比 6.63% vs 圈外 2.97%）",
    },
    {
        "id": "luchaogang",
        "name": "浦东芦潮港渔港路",
        "district": "浦东新区",
        "category": "海鲜",
        "radius_km": 5.0,
        "lng": 121.84928,
        "lat": 30.85897,
        "desc": "浦东定点渔业上岸点（5 km 圈内 19/47 = 40.43%，注意圈内仅 47 条样本）",
    },
    {
        "id": "customhouse",
        "name": "外滩江海关大楼",
        "district": "黄浦区",
        "category": "西餐",
        "radius_km": 1.0,
        "lng": 121.485417,
        "lat": 31.238611,
        "desc": "原黄浦区开埠与租界历史地标（1 km 圈内西餐占比 10.60% vs 圈外 6.01%）",
    },
    {
        "id": "gubei",
        "name": "长宁古北新区 (黄金城道)",
        "district": "长宁区",
        "category": "本菜",
        "radius_km": 1.5,
        "lng": 121.402,
        "lat": 31.195,
        "desc": "涉外日本社区地标（1.5 km 圈内「本菜/日本菜*」占比 21.20% vs 圈外 8.32%）",
    },
    {
        "id": "hongquan",
        "name": "闵行虹泉路韩国街",
        "district": "闵行区",
        "category": "料理",
        "radius_km": 1.5,
        "lng": 121.373883,
        "lat": 31.17215,
        "desc": "韩国料理集聚街区（1.5 km 圈内「料理/韩国料理*」占比 15.95% vs 圈外 2.24%）",
    },
]


def load_code_list(path: Path, name_col: str) -> list[str]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [row[name_col].strip() for row in csv.DictReader(f)]


def load_records() -> tuple[str, list[dict]]:
    if JSONL_PATH.exists():
        rows = []
        with open(JSONL_PATH, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
        return "data/hbase_export.jsonl (HBase 导出)", rows

    rows = []
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            rows.append(r)
    return "data/clean_restaurant.csv", rows


def to_int(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def to_float(v) -> float:
    try:
        return round(float(v), 6)
    except (TypeError, ValueError):
        return 0.0


def build_payload() -> dict:
    districts = load_code_list(DIST_CODE_PATH, "district")
    categories = load_code_list(CAT_CODE_PATH, "category")

    d_map = {name: i for i, name in enumerate(districts)}
    c_map = {name: i for i, name in enumerate(categories)}
    pl_map = {name: i for i, name in enumerate(PRICE_LEVELS)}

    source_name, raw_rows = load_records()

    compact_records = []
    dist_counts = Counter()
    cat_counts = Counter()
    outside_sh = 0

    for r in raw_rows:
        d_name = str(r.get("district", "")).strip()
        c_name = str(r.get("category", "")).strip()
        if d_name not in d_map:
            d_map[d_name] = len(districts)
            districts.append(d_name)
        if c_name not in c_map:
            c_map[c_name] = len(categories)
            categories.append(c_name)

        d_idx = d_map[d_name]
        c_idx = c_map[c_name]
        pl_idx = pl_map.get(str(r.get("price_level", "未知")).strip(), 0)
        avg_price = to_int(r.get("avg_price"))
        reviews = to_int(r.get("reviews"))
        usable = 1 if str(r.get("is_usable", "0")).strip() == "1" else 0
        lng = to_float(r.get("lng"))
        lat = to_float(r.get("lat"))

        if not (120.8 <= lng <= 122.2 and 30.6 <= lat <= 31.9):
            outside_sh += 1

        dist_counts[d_name] += 1
        cat_counts[c_name] += 1

        compact_records.append([
            str(r.get("rowkey", "")).strip(),
            d_idx,
            c_idx,
            avg_price,
            reviews,
            pl_idx,
            usable,
            lng,
            lat,
        ])

    return {
        "meta": {
            "total": len(compact_records),
            "source": source_name,
            "outside_shanghai_coords": outside_sh,
        },
        "districts": districts,
        "categories": categories,
        "priceLevels": PRICE_LEVELS,
        "districtCounts": [dist_counts[d] for d in districts],
        "categoryCounts": [cat_counts[c] for c in categories],
        "landmarks": LANDMARKS,
        "records": compact_records,
    }


def main() -> int:
    payload = build_payload()
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    print(f"[OK] source={payload['meta']['source']}")
    print(f"[OK] wrote {payload['meta']['total']:,} records -> {OUT_PATH} ({size_mb:.2f} MB)")
    print(f"[INFO] outside Shanghai bbox: {payload['meta']['outside_shanghai_coords']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
