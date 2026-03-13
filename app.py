"""
TaxEasy — Federal Tax Estimator
Flask application. All tax math runs server-side in Python.
The frontend posts form state as JSON; this module calculates and returns results.
"""

from flask import Flask, render_template, request, jsonify
from tax_data import TAX_YEARS

app = Flask(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pos(val) -> float:
    """Parse a value to a non-negative float, returning 0 on failure."""
    try:
        return max(0.0, float(val or 0))
    except (TypeError, ValueError):
        return 0.0


def _brackets(yd: dict, status: str) -> list:
    """Return the bracket list for a filing status. married_sep uses single brackets."""
    key = "single" if status == "married_sep" else status
    return yd["brackets"].get(key, yd["brackets"]["single"])


def _calc_tax(taxable: float, yd: dict, status: str) -> tuple:
    """
    Progressive bracket calculation.
    Returns (total_tax: float, details: list[dict]).
    """
    total = 0.0
    details = []
    for b in _brackets(yd, status):
        if taxable <= b["min"]:
            break
        in_b = min(taxable, b["max"]) - b["min"]
        tax  = in_b * b["rate"]
        total += tax
        details.append({
            "rate":       b["rate"],
            "label":      f"{int(b['rate'] * 100)}%",
            "in_bracket": round(in_b, 2),
            "tax":        round(tax, 2),
        })
    return round(total, 2), details


def _marginal_rate(taxable: float, yd: dict, status: str) -> float:
    """Return the marginal rate for the given taxable income."""
    for b in _brackets(yd, status):
        if b["min"] <= taxable < b["max"]:
            return b["rate"]
    return 0.37


def _standard_deduction(yd: dict, status: str, age: int) -> float:
    """Standard deduction plus the 65+ bonus where applicable."""
    base = yd["std_ded"].get(status, yd["std_ded"]["single"])
    if age >= 65:
        base += yd["extra_65"].get(status, 1950)
    return float(base)


# ── Core calculation ──────────────────────────────────────────────────────────

def compute_tax(data: dict) -> dict:
    """
    Full federal tax calculation from raw form state.

    Accepts a dict matching the frontend state shape:
        { taxYear, filing, income, deductions, credits }

    Returns a flat dict of all computed values consumed by the summary view.
    """
    year = int(data.get("taxYear", 2024))
    yd   = TAX_YEARS.get(year, TAX_YEARS[2024])

    # Filing
    f      = data.get("filing", {})
    status = f.get("status") or "single"
    age    = int(f.get("age") or 0)
    deps   = min(int(f.get("dependents") or 0), 10)

    # Income
    inc      = data.get("income", {})
    wages    = _pos(inc.get("wages"))
    se_raw   = _pos(inc.get("selfEmployed"))
    invest   = _pos(inc.get("investments"))
    other    = _pos(inc.get("other"))
    withheld = _pos(inc.get("withheld"))
    gross    = wages + se_raw + invest + other

    # Self-employment tax (15.3% on 92.35% of net SE income)
    se_tax = (se_raw * 0.9235 * 0.153) if se_raw > 400 else 0.0

    # Above-the-line deductions
    ded    = data.get("deductions", {})
    ret_d  = min(_pos(ded.get("retirement")),          yd["k401_limit"])
    hsa_d  = min(_pos(ded.get("hsa")),                 yd["hsa_fam"])
    sl_d   = min(_pos(ded.get("studentLoanInterest")), 2500.0)
    seh_d  = _pos(ded.get("selfEmpHealth"))
    agi_adj = ret_d + hsa_d + sl_d + seh_d + se_tax / 2
    agi     = max(0.0, gross - agi_adj)

    # Itemized deductions
    std_ded = _standard_deduction(yd, status, age)
    salt    = min(_pos(ded.get("stateTaxes")), 10_000.0)
    mortgage = _pos(ded.get("mortgage"))
    charity  = _pos(ded.get("charitableCash"))
    med_d    = max(0.0, _pos(ded.get("medicalExpenses")) - agi * 0.075)
    item_tot = mortgage + salt + charity + med_d
    itemizing = item_tot > std_ded
    ded_used  = max(std_ded, item_tot)

    # Taxable income & bracket tax
    taxable = max(0.0, agi - ded_used)
    inc_tax, bracket_detail = _calc_tax(taxable, yd, status)
    mr = _marginal_rate(taxable, yd, status)

    # Credits
    c       = data.get("credits", {})
    credits = 0.0
    if c.get("childTax"):
        credits += deps * 2000
    if c.get("childCare"):
        credits += 2100 if deps >= 2 else 1050
    if c.get("eitc"):
        lim = yd["eitc_limits"]["married"] if status == "married" else yd["eitc_limits"]["single"]
        if gross < lim:
            credits += yd["eitc_amounts"].get(min(deps, 3), yd["eitc_amounts"][0])
    if c.get("educationCredit"):
        credits += 2500
    if c.get("llc"):
        credits += 2000
    if c.get("saverCredit") and agi < (73_000 if status == "married" else 36_500):
        credits += 1000
    if c.get("solarCredit"):
        credits += 5000
    if c.get("energyCredit"):
        credits += 3200
    if c.get("evCredit"):
        credits += 7500

    fed_tax  = max(0.0, inc_tax + se_tax - credits)
    balance  = withheld - fed_tax
    eff_rate = (fed_tax / gross * 100) if gross > 0 else 0.0

    # Personalised tax-saving suggestions
    suggestions = []
    ret_gap = yd["k401_limit"] - ret_d
    if ret_gap > 200:
        save = ret_gap * (mr or 0.22)
        suggestions.append({
            "icon": "🏦", "color": "#2DD4BF",
            "title": f"Max your 401(k) — save ~${save:,.0f}",
            "desc":  (f"${ret_gap:,.0f} of unused 401(k) room in {year}. "
                      f"Every dollar reduces taxable income at your {int(mr*100)}% marginal rate."),
        })
    if not ded.get("hsa"):
        suggestions.append({
            "icon": "🏥", "color": "#818CF8",
            "title": "Open a Health Savings Account (HSA)",
            "desc":  (f"Triple-tax advantage: deductible contributions, tax-free growth, "
                      f"tax-free medical withdrawals. {year} limit: "
                      f"${yd['hsa_self']:,} self / ${yd['hsa_fam']:,} family."),
        })
    if se_raw > 3000 and ret_d < yd["k401_limit"]:
        suggestions.append({
            "icon": "📈", "color": "#F59E0B",
            "title": "Open a SEP-IRA or Solo 401(k)",
            "desc":  (f"Self-employed people can shelter up to 25% of net profit "
                      f"(~${se_raw * 0.25:,.0f}) in a SEP-IRA — far exceeding the standard 401(k) limit."),
        })
    if deps > 0 and not c.get("childCare"):
        suggestions.append({
            "icon": "👶", "color": "#F472B6",
            "title": "Claim the Dependent Care Credit",
            "desc":  ("You have dependents but haven't claimed Child & Dependent Care. "
                      "Go back to Credits and enable it to claim up to $2,100."),
        })
    if gross > 60_000 and not c.get("solarCredit") and not c.get("energyCredit"):
        suggestions.append({
            "icon": "☀️", "color": "#34D399",
            "title": "Home energy credits — up to 30% back",
            "desc":  "Solar panels: 30% credit, no cap. Heat pumps + insulation: up to $3,200. Unused credits carry forward.",
        })
    if not itemizing and item_tot > std_ded * 0.65 and item_tot > 0:
        suggestions.append({
            "icon": "🎁", "color": "#FB923C",
            "title": "Bundle donations to unlock itemizing",
            "desc":  (f"You are only ${std_ded - item_tot:,.0f} away from beating the standard "
                      "deduction. A Donor-Advised Fund lets you prepay multiple years of giving in one go."),
        })

    return {
        # Computed values
        "year":           year,
        "gross":          round(gross, 2),
        "se_tax":         round(se_tax, 2),
        "agi_adj":        round(agi_adj, 2),
        "agi":            round(agi, 2),
        "std_ded":        round(std_ded, 2),
        "item_tot":       round(item_tot, 2),
        "ded_used":       round(ded_used, 2),
        "itemizing":      itemizing,
        "taxable":        round(taxable, 2),
        "inc_tax":        round(inc_tax, 2),
        "credits":        round(credits, 2),
        "fed_tax":        round(fed_tax, 2),
        "withheld":       round(withheld, 2),
        "balance":        round(balance, 2),
        "is_refund":      balance >= 0,
        "eff_rate":       round(eff_rate, 1),
        "marginal_rate":  mr,
        "bracket_detail": bracket_detail,
        "suggestions":    suggestions,
        # Year limits (used by deductions live hints)
        "k401_limit":     yd["k401_limit"],
        "hsa_self":       yd["hsa_self"],
        "hsa_fam":        yd["hsa_fam"],
        "ira_limit":      yd["ira_limit"],
        "salt_capped":    round(salt, 2),
        "med_deductible": round(med_d, 2),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the main app shell."""
    return render_template("index.html")


@app.route("/api/calculate", methods=["POST"])
def calculate():
    """
    POST { taxYear, filing, income, deductions, credits }
    Returns full tax calculation result as JSON.
    Called on every Summary render and for live deduction hints.
    """
    data = request.get_json(force=True)
    try:
        result = compute_tax(data)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/tax_years")
def tax_years_route():
    """Return supported tax years and their key limits for the frontend year selector."""
    out = {}
    for year, yd in TAX_YEARS.items():
        out[str(year)] = {
            "k401_limit":   yd["k401_limit"],
            "hsa_self":     yd["hsa_self"],
            "hsa_fam":      yd["hsa_fam"],
            "ira_limit":    yd["ira_limit"],
            "std_ded":      yd["std_ded"],
            "extra_65":     yd["extra_65"],
            "eitc_limits":  yd["eitc_limits"],
            "eitc_amounts": {str(k): v for k, v in yd["eitc_amounts"].items()},
        }
    return jsonify(out)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
