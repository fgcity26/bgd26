#!/usr/bin/env python3
"""Structural validator for the bgd26 Prisma schema (no Prisma CLI needed).

Usage: python3 scripts/check-schema.py [path/to/schema.prisma]
Checks: 84 required tables, field/type validity, every relation has a matching
back-relation, FK targets are unique, relation optionality, indexes reference
real columns. Run before every commit that touches the schema.
"""
import re, sys, collections

PATH = sys.argv[1] if len(sys.argv) > 1 else "prisma/schema.prisma"
SCALARS = {"String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes"}

REQUIRED = {
    "users","roles","permissions","user_roles","role_permissions","audit_logs",
    "customers","customer_addresses","customer_mobile_history","customer_notes","customer_segments","loyalty_transactions",
    "categories","brands","products","product_variants","bundle_items","media_assets","product_media",
    "warehouses","stores","inventory_balances","inventory_cost_history","stock_ledger","stock_reservations","stock_transfers","stock_transfer_items","stock_adjustments","stock_conflict_exceptions","inventory_reconciliation_runs",
    "suppliers","purchase_orders","purchase_items","goods_received_notes","goods_received_items","purchase_payments","purchase_returns",
    "orders","order_items","order_item_customizations","order_status_history","carts","cart_items","coupons","coupon_redemptions","delivery_zones",
    "payment_requests","payments","payment_transactions","payment_verifications","payment_settlements","payment_audit_logs","refunds","refund_items","refund_transactions",
    "production_jobs","production_job_items","customization_files","design_revisions","design_approvals","production_status_history",
    "couriers","shipments","shipment_tracking_events",
    "fiscal_periods","accounts","journal_entries","journal_entry_lines","customer_ledgers","supplier_ledgers","cash_accounts","bank_accounts","expenses",
    "pos_devices","pos_shifts","pos_cash_movements","pos_sync_queue","pos_sync_logs",
    "whatsapp_conversations","whatsapp_messages","whatsapp_templates","whatsapp_consents","ai_conversation_logs","ai_action_logs",
    "product_reviews","review_media","wishlists","wishlist_items","newsletter_subscribers","site_pages",
}

text = open(PATH, encoding="utf-8").read()
lines = text.splitlines()
errors, warnings = [], []

# ---------- parse ----------
enums = {}   # name -> [values]
models = {}  # name -> {"fields": {name: info}, "attrs": [...], "line": int}
order = []
cur = None
kind = None

for i, raw in enumerate(lines, 1):
    line = raw.split("//")[0].strip()
    if not line:
        continue
    m = re.match(r"^(model|enum)\s+(\w+)\s*\{$", line)
    if m:
        kind, cur = m.group(1), m.group(2)
        if kind == "enum":
            enums[cur] = []
        else:
            if cur in models:
                errors.append(f"L{i}: duplicate model {cur}")
            models[cur] = {"fields": {}, "attrs": [], "line": i}
            order.append(cur)
        continue
    if line == "}":
        cur = None; kind = None
        continue
    if cur is None:
        if line.startswith("model") or line.startswith("enum"):
            errors.append(f"L{i}: malformed block header: {line}")
        continue
    if kind == "enum":
        if re.match(r"^\w+$", line):
            enums[cur].append(line)
        else:
            errors.append(f"L{i}: bad enum value in {cur}: {line}")
        continue
    if line.startswith("@@"):
        models[cur]["attrs"].append((line, i))
        continue
    parts = line.split()
    if len(parts) < 2:
        errors.append(f"L{i}: bad field line in {cur}: {line}")
        continue
    fname, ftype = parts[0], parts[1]
    rest = line[len(fname):].strip()
    if fname in models[cur]["fields"]:
        errors.append(f"L{i}: duplicate field {cur}.{fname}")
    models[cur]["fields"][fname] = {"type": ftype, "rest": rest, "line": i}

# ---------- helpers ----------
def base_type(t):
    return t.rstrip("?").replace("[]", "")

def is_list(t):
    return t.endswith("[]")

def is_opt(t):
    return t.endswith("?")

def attrs(model):
    return models[model]["attrs"]

def map_name(model):
    for a, _ in attrs(model):
        m = re.match(r'@@map\("([^"]+)"\)', a)
        if m: return m.group(1)
    return None

def id_fields(model):
    f = models[model]["fields"]
    for name, info in f.items():
        if re.search(r"@id\b", info["rest"]):
            return [name]
    for a, _ in attrs(model):
        m = re.match(r"@@id\(\[([^\]]+)\]\)", a)
        if m: return [x.strip() for x in m.group(1).split(",")]
    return []

def unique_sets(model):
    """Returns list of field-name sets that are unique (single or composite)."""
    out = []
    for name, info in models[model]["fields"].items():
        if re.search(r"@unique\b", info["rest"]):
            out.append({name})
    for a, _ in attrs(model):
        m = re.match(r"@@unique\(\[([^\]]+)\]\)", a)
        if m:
            out.append({x.strip() for x in m.group(1).split(",")})
    return out

def relation_info(info):
    """Parse @relation(...) -> (name, fields, references)"""
    m = re.search(r"@relation\((.*)\)", info["rest"])
    if not m:
        return None, None, None
    body = m.group(1)
    name = None
    nm = re.match(r'\s*"([^"]+)"', body)
    if nm:
        name = nm.group(1)
    fields = None; refs = None
    fm = re.search(r"fields:\s*\[([^\]]*)\]", body)
    if fm: fields = [x.strip() for x in fm.group(1).split(",") if x.strip()]
    rm = re.search(r"references:\s*\[([^\]]*)\]", body)
    if rm: refs = [x.strip() for x in rm.group(1).split(",") if x.strip()]
    return name, fields, refs

# ---------- checks ----------
table_names = collections.Counter()
for m in order:
    tn = map_name(m)
    if not tn:
        errors.append(f"{m}: missing @@map")
        continue
    table_names[tn] += 1

for tn, c in table_names.items():
    if c > 1:
        errors.append(f"duplicate table name {tn}")
for req in sorted(REQUIRED):
    if req not in table_names:
        errors.append(f"missing required table: {req}")
for tn in table_names:
    if tn not in REQUIRED:
        warnings.append(f"extra table (not in Section 4 list): {tn}")

EXPECTED = len(REQUIRED)
if len(table_names) != EXPECTED:
    errors.append(f"table count is {len(table_names)}, expected {EXPECTED}")

# field type validity + basic attribute checks
for m, data in models.items():
    f = data["fields"]
    pk = id_fields(m)
    if not pk:
        errors.append(f"{m}: no primary key")
    for name, info in f.items():
        t = info["type"]
        bt = base_type(t)
        if bt not in SCALARS and bt not in enums and bt not in models:
            errors.append(f"L{info['line']}: {m}.{name} unknown type {t}")
        if is_list(t) and is_opt(t):
            errors.append(f"L{info['line']}: {m}.{name} cannot be optional list")
        if bt in enums:
            dm = re.search(r"@default\(([^)]*)\)", info["rest"])
            if dm and not dm.group(1).startswith("["):
                val = dm.group(1).strip()
                if val not in enums[bt]:
                    errors.append(f"L{info['line']}: {m}.{name} default {val} not in enum {bt}")
        if t.startswith("Decimal") and "@db.Decimal" not in info["rest"]:
            warnings.append(f"L{info['line']}: {m}.{name} Decimal without precision")
    # composite attrs reference real fields
    for a, ln in data["attrs"]:
        for tag in ("@@id", "@@unique", "@@index"):
            mm = re.match(re.escape(tag) + r"\(\[([^\]]+)\]", a)
            if mm:
                for col in [x.strip().split("(")[0] for x in mm.group(1).split(",")]:
                    if col and col not in f:
                        errors.append(f"L{ln}: {m} {tag} references unknown field {col}")

# relation graph
rel_edges = []  # (model, field, target, name, fields, refs, is_list, line)
for m, data in models.items():
    for fname, info in data["fields"].items():
        bt = base_type(info["type"])
        if bt in models:
            name, fields, refs = relation_info(info)
            rel_edges.append((m, fname, bt, name, fields, refs, is_list(info["type"]), info["line"]))

# FK declarations
for m, fname, target, name, fields, refs, is_list, ln in rel_edges:
    if fields is None:
        continue
    if is_list:
        errors.append(f"L{ln}: {m}.{fname} is a list but declares fields")
    if not fields or not refs:
        errors.append(f"L{ln}: {m}.{fname} @relation missing fields/references")
        continue
    if len(fields) != len(refs):
        errors.append(f"L{ln}: {m}.{fname} fields/references length mismatch")
    for col in fields:
        if col not in models[m]["fields"]:
            errors.append(f"L{ln}: {m}.{fname} FK field {col} does not exist")
    tgt_pk = id_fields(target)
    for ref in refs:
        if ref not in models[target]["fields"]:
            errors.append(f"L{ln}: {m}.{fname} references missing {target}.{ref}")
            continue
        uniques = unique_sets(target)
        if not any(ref in u for u in uniques) and ref not in tgt_pk:
            errors.append(f"L{ln}: {m}.{fname} references non-unique {target}.{ref}")
    # optionality consistency
    opt_fk = any(is_opt(models[m]["fields"][c]["type"]) for c in fields)
    if opt_fk != is_opt(models[m]["fields"][fname]["type"]):
        errors.append(f"L{ln}: {m}.{fname} optionality mismatch with FK")
    # 1-1 incoming: if target side is singular non-list, this FK must be unique
    if not is_list:
        uniques = unique_sets(m)
        if not any(set(fields).issubset(u) for u in uniques):
            # only an error if the opposite field is NOT a list (will check below)
            pass

# back-relation completeness + name matching
by_pair = collections.defaultdict(list)
for e in rel_edges:
    by_pair[frozenset((e[0], e[2]))].append(e)

for m, fname, target, name, fields, refs, is_list, ln in rel_edges:
    candidates = [e for e in rel_edges if e[0] == target and base_type(e[2]) == m
                  and not (e[0] == m and e[1] == fname)]
    if not candidates:
        errors.append(f"L{ln}: {m}.{fname} -> {target} has NO back-relation on {target}")
        continue
    named = [c for c in candidates if c[3] == name]
    if name is not None:
        if not named:
            errors.append(f"L{ln}: {m}.{fname} named '{name}' has no matching back-relation on {target}")
        elif len(named) > 1:
            errors.append(f"L{ln}: {m}.{fname} ambiguous named back-relations on {target}")
        continue
    # unnamed field: valid only if exactly one relation between the pair, or a unique unnamed candidate
    unnamed = [c for c in candidates if c[3] is None]
    if len(candidates) > 1 and len(unnamed) != 1:
        errors.append(f"L{ln}: {m}.{fname} -> {target}: multiple relations but no unique unnamed back-relation")
    elif len(unnamed) == 0 and len(candidates) >= 1:
        errors.append(f"L{ln}: {m}.{fname} -> {target}: back-relation(s) all named while this side is unnamed")
    elif len(unnamed) > 1:
        errors.append(f"L{ln}: {m}.{fname} -> {target}: {len(unnamed)} ambiguous unnamed back-relations")

# duplicate unnamed relations between same pair on same model
pair_counts = collections.Counter()
for e in rel_edges:
    if e[3] is None:
        pair_counts[(e[0], e[2])] += 1
for (a, b), c in pair_counts.items():
    if c > 1 and a != b:
        errors.append(f"{a} <-> {b}: {c} unnamed relations (must name them)")

# check one-to-one singular back-relation requires unique FK side
for e in rel_edges:
    m, fname, target, name, fields, refs, is_list, ln = e
    if fields is None:
        continue
    opposite = [o for o in rel_edges if o[0] == target and base_type(o[2]) == m and o[3] == name]
    if len(opposite) == 1 and not opposite[0][6]:  # opposite is singular -> 1:1
        uniques = unique_sets(m)
        if not any(set(fields).issubset(u) for u in uniques):
            errors.append(f"L{ln}: {m}.{fname} is 1:1 but FK {fields} is not unique")
    # A unique FK with a list opposite is contradictory: the list side must be singular.
    uniques = unique_sets(m)
    if any(set(fields) == u for u in uniques) and len(opposite) == 1 and opposite[0][6]:
        errors.append(f"L{ln}: {m}.{fname} has a unique FK but opposite {target}.{opposite[0][1]} is a list")

# ---------- report ----------
print(f"models: {len(models)} | tables: {len(table_names)} | enums: {len(enums)} | relations: {len(rel_edges)}")
print(f"fields with Decimal: {sum(1 for m in models for i in models[m]['fields'].values() if i['type'].startswith('Decimal'))}")
if warnings:
    print(f"\nWARNINGS ({len(warnings)}):")
    for w in warnings: print("  -", w)
if errors:
    print(f"\nERRORS ({len(errors)}):")
    for x in errors: print("  -", x)
    sys.exit(1)
print("\nOK: no structural errors found.")
