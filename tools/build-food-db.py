#!/usr/bin/env python3
"""Builds data/foods-cnf.json — the bundled offline food database — from the
Canadian Nutrient File (Health Canada, Open Government Licence – Canada).

Downloads the CNF CSV bundle if not already present, curates ~2,000-2,500
common foods (staples first, exotic/branded-legacy noise dropped), attaches
per-100g macros + up to 3 household servings, and assigns a popularity rank
used for search-result ordering.

Run from the repo root:  python3 tools/build-food-db.py
"""
import csv, io, json, os, re, sys, urllib.request, zipfile
from collections import defaultdict

CNF_URL = ('https://www.canada.ca/content/dam/hc-sc/migration/hc-sc/fn-an/'
           'alt_formats/zip/nutrition/fiche-nutri-data/cnf-fcen-csv.zip')
CACHE_DIR = '/tmp/cnf'
OUT = 'data/foods-cnf.json'
SIZE_WARN = 800 * 1024

NUTRIENTS = {'203': 'p', '204': 'f', '205': 'c', '208': 'kcal'}

# groups kept, with a cap on how many foods each may contribute
GROUP_CAPS = {
    '1': 190,   # Dairy and Egg
    '4': 60,    # Fats and Oils
    '5': 150,   # Poultry
    '6': 50,    # Soups, Sauces and Gravies
    '7': 70,    # Sausages and Luncheon meats
    '8': 90,    # Breakfast cereals
    '9': 220,   # Fruits and juices
    '10': 100,  # Pork
    '11': 340,  # Vegetables
    '12': 90,   # Nuts and Seeds
    '13': 130,  # Beef
    '14': 100,  # Beverages
    '15': 200,  # Finfish and Shellfish
    '16': 120,  # Legumes
    '17': 70,   # Lamb, Veal and Game
    '18': 150,  # Baked Products
    '19': 100,  # Sweets
    '20': 130,  # Cereals, Grains and Pasta
    '21': 90,   # Fast Foods
    '22': 70,   # Mixed Dishes
    '25': 70,   # Snacks
}

# foods whose description contains any of these are dropped outright
BLACKLIST = [
    'baby', 'infant', 'formula, ', 'whale', 'seal,', 'seal ', 'walrus',
    'muktuk', 'caribou hide', 'polar bear', 'bear,', 'lynx', 'muskrat',
    'raccoon', 'opossum', 'armadillo', 'squirrel', 'beaver', 'groundhog',
    'horse,', 'moose liver', 'usda commodity', 'worthington', 'loma linda',
    'morningstar', 'mori-nu', 'industrial', 'shortening industrial',
    'dehydrated', 'freeze-dried', 'low sodium, ns', 'institutional',
]

# staple keywords → score bonus; drives both curation and search ranking
STAPLES = {
    'yogourt': 6, 'yogourt, greek': 7, 'yogourt, plain': 6,
    'chicken breast': 7, 'chicken, breast': 7, 'ground beef': 7, 'ground turkey': 6,
    'ground chicken': 5, 'ground pork': 4, 'egg,': 6, 'eggs,': 6, 'egg white': 6,
    'rice,': 6, 'oats': 6, 'oatmeal': 5, 'banana': 6, 'apple': 5, 'potato': 6,
    'sweet potato': 6, 'milk,': 5, 'yogurt': 6, 'greek': 4, 'bread': 5, 'pasta': 5,
    'salmon': 6, 'tuna': 6, 'shrimp': 5, 'cod,': 5, 'tilapia': 5, 'trout': 4,
    'broccoli': 6, 'spinach': 5, 'peanut butter': 6, 'cheese, cheddar': 5,
    'cheese, mozzarella': 5, 'cottage cheese': 6, 'cheese': 3, 'turkey': 4,
    'bacon': 5, 'butter': 4, 'olive oil': 6, 'canola': 4, 'avocado': 6,
    'strawberr': 5, 'blueberr': 5, 'raspberr': 4, 'orange': 4, 'grape': 3,
    'carrot': 5, 'tomato': 5, 'onion': 4, 'pepper, sweet': 4, 'mushroom': 4,
    'bean': 3, 'black bean': 5, 'kidney bean': 4, 'lentil': 5, 'chickpea': 5,
    'quinoa': 5, 'tofu': 5, 'corn': 3, 'peas': 4, 'zucchini': 4, 'cucumber': 4,
    'lettuce': 4, 'kale': 4, 'cauliflower': 4, 'asparagus': 4, 'green bean': 5,
    'whole wheat': 4, 'whole grain': 3, 'sirloin': 5, 'tenderloin': 5,
    'flank': 4, 'rib eye': 4, 'striploin': 4, 'chop': 3, 'ham,': 4,
    'almond': 5, 'walnut': 4, 'cashew': 4, 'peanut': 4, 'pistachio': 3,
    'honey': 4, 'maple syrup': 6, 'jam': 3, 'ketchup': 4, 'mayonnaise': 4,
    'mustard': 3, 'salsa': 4, 'hummus': 5, 'granola': 4, 'bagel': 4,
    'tortilla': 4, 'pita': 4, 'cracker': 3, 'popcorn': 4, 'chips': 3,
    'chocolate': 3, 'ice cream': 4, 'cookie': 3, 'muffin': 3, 'pancake': 4,
    'waffle': 3, 'syrup': 2, 'poutine': 6, 'pierogi': 4, 'perogi': 4,
    'back bacon': 5, 'wild rice': 5, 'venison': 3, 'bison': 3, 'elk': 2,
    'coffee': 4, 'tea,': 3, 'beer': 4, 'wine': 4, 'cola': 4, 'juice': 3,
    'protein': 3, 'whey': 4, 'soy beverage': 4, 'almond beverage': 4,
    'cereal': 3, 'pizza': 4, 'hamburger': 4, 'french fries': 5, 'hot dog': 4,
    'sausage': 3, 'pepperoni': 3, 'salami': 3, 'deli': 3, 'roast': 2,
    'cooked': 1, 'roasted': 1, 'grilled': 1, 'boiled': 1, 'raw': 1,
}

# description segments that add no value on a phone screen
NOISE_SEGMENTS = [
    'broilers or fryers', 'separable lean and fat', 'separable lean only',
    'separable fat', 'composite of trimmed retail cuts', 'all classes',
    'meat and skin', 'ns as to form', 'prepared with water',
    'solids and liquids', 'drained solids', 'without salt', 'with salt',
    'trimmed to 0" fat', "trimmed to 0' fat", 'trimmed to 1/8" fat',
    'trimmed to 1/4" fat', 'lean and fat', 'edible portion',
]


def ensure_data():
    if not os.path.exists(os.path.join(CACHE_DIR, 'FOOD NAME.csv')):
        os.makedirs(CACHE_DIR, exist_ok=True)
        print('downloading CNF …')
        buf = urllib.request.urlopen(CNF_URL, timeout=120).read()
        zipfile.ZipFile(io.BytesIO(buf)).extractall(CACHE_DIR)


def read(name):
    with open(os.path.join(CACHE_DIR, name), encoding='latin-1') as f:
        yield from csv.DictReader(f)


def clean_name(desc):
    segs = [s.strip() for s in desc.split(',')]
    segs = [s for s in segs if s and s.lower() not in NOISE_SEGMENTS]
    segs = segs[:5]
    name = ', '.join(segs)
    name = re.sub(r'\s+', ' ', name).strip()
    return name[:80]


def score(desc, group):
    d = desc.lower()
    s = -len(desc) / 38.0
    # top-2 keyword hits only — otherwise compound junk ("peanut butter
    # chocolate sandwich cookie") stacks bonuses and outranks staples
    hits = sorted((w for kw, w in STAPLES.items() if kw in d), reverse=True)
    if hits:
        s += hits[0] + (0.4 * hits[1] if len(hits) > 1 else 0)
    if d.startswith('candies') or d.startswith('fast foods'):
        s -= 2.5
    return s


def main():
    ensure_data()

    macros = defaultdict(dict)
    for row in read('NUTRIENT AMOUNT.csv'):
        key = NUTRIENTS.get(row['NutrientID'])
        if key:
            try: macros[row['FoodID']][key] = float(row['NutrientValue'])
            except ValueError: pass

    measures = {}
    for row in read('MEASURE NAME.csv'):
        measures[row['MeasureID']] = row['MeasureDescription'].strip()

    servings = defaultdict(list)
    for row in read('CONVERSION FACTOR.csv'):
        try: factor = float(row['ConversionFactorValue'])
        except ValueError: continue
        desc = measures.get(row['MeasureID'], '')
        grams = round(factor * 100)
        if not desc or not re.match(r'^\d', desc) or not (1 <= grams <= 1200):
            continue
        if re.search(r'\bml\b', desc) and 'cup' not in desc and 'tbsp' not in desc and 'tsp' not in desc:
            # volume-only measures for liquids are fine; keep them
            pass
        servings[row['FoodID']].append((desc, grams))

    picked = defaultdict(list)
    for row in read('FOOD NAME.csv'):
        gid = row['FoodGroupID']
        if gid not in GROUP_CAPS:
            continue
        desc = row['FoodDescription'].strip()
        low = desc.lower()
        if any(b in low for b in BLACKLIST):
            continue
        m = macros.get(row['FoodID'], {})
        if 'kcal' not in m or ('p' not in m and 'c' not in m and 'f' not in m):
            continue
        picked[gid].append((score(desc, gid), row['FoodID'], desc))

    out, seen_names = [], set()
    for gid, cap in GROUP_CAPS.items():
        kept = 0
        for s, fid, desc in sorted(picked[gid], reverse=True):
            if kept >= cap:
                break
            name = clean_name(desc)
            key = name.lower()
            if key in seen_names:
                continue
            seen_names.add(key)
            m = macros[fid]
            serv = []
            for sdesc, grams in servings.get(fid, []):
                if len(serv) >= 3: break
                if any(abs(grams - g) <= 2 for _, g in serv): continue
                serv.append((sdesc[:34], grams))
            out.append({
                'n': name,
                'k': round(m.get('kcal', 0)),
                'p': round(m.get('p', 0), 1),
                'c': round(m.get('c', 0), 1),
                'f': round(m.get('f', 0), 1),
                'r': round(s, 1),
                's': [[d, g] for d, g in serv],
            })
            kept += 1

    out.sort(key=lambda f: -f['r'])
    payload = json.dumps({'source': 'Canadian Nutrient File 2015 © Health Canada',
                          'license': 'Open Government Licence – Canada',
                          'foods': out}, ensure_ascii=False, separators=(',', ':'))
    os.makedirs('data', exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(payload)
    size = os.path.getsize(OUT)
    print(f'{OUT}: {len(out)} foods, {size/1024:.0f} KB')
    if size > SIZE_WARN:
        print(f'WARNING: exceeds {SIZE_WARN//1024} KB budget', file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
