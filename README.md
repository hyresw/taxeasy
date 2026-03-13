# TaxEasy 💼 (Python/Flask)

> **Your federal taxes, simplified.** A clean, fast federal tax estimator built with Python and Flask. All tax math runs server-side in Python — making it easy to extend, test, and integrate into larger projects.

![Tax Years](https://img.shields.io/badge/Tax%20Years-2022–2025-2DD4BF?style=flat-square) ![Python](https://img.shields.io/badge/Python-3.10+-818CF8?style=flat-square) ![Flask](https://img.shields.io/badge/Flask-3.0-34D399?style=flat-square)

---

## ✨ Features

- **5-step wizard** — Filing Status → Income → Deductions → Credits → Summary
- **Tax years 2022–2025** with accurate IRS bracket data for each year
- **All tax math in Python** — easy to unit test, extend, and integrate
- **Live deduction comparison** — real-time standard vs. itemized feedback
- **Personalized suggestions** — up to 6 context-aware tax-saving tips
- **Bracket breakdown** — visual bar chart showing bracket-by-bracket tax
- **Info tooltips** — every field has a plain-English explanation with examples
- **REST API** — clean `/api/calculate` endpoint you can call from anywhere
- **Zero frontend dependencies** — vanilla JS only, no npm, no build step

---

## 🗂️ Project Structure

```
taxeasy/
├── app.py              # Flask server + all tax calculation logic
├── tax_data.py         # IRS bracket and limit data (2022–2025)
├── templates/
│   └── index.html      # HTML/CSS shell (UI layout only)
├── static/
│   └── app.js          # Frontend JS (UI interactions, calls API)
├── requirements.txt
└── README.md
```

**Where the tax math lives:** Everything is in `app.py` → `compute_tax()`. It's a single, well-commented function that takes the form state and returns a complete results dict. `tax_data.py` holds all the IRS numbers — easy to update each year.

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/yourusername/taxeasy.git
cd taxeasy

# 2. Create a virtual environment
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run
python app.py
```

Open `http://localhost:5000` in your browser.

---

## 🔌 API Reference

### `POST /api/calculate`

Run the full tax calculation. Accepts the form state as JSON and returns all computed values.

**Request body:**
```json
{
  "taxYear": 2024,
  "filing": {
    "status": "single",
    "dependents": "2",
    "age": "35"
  },
  "income": {
    "wages": "75000",
    "selfEmployed": "0",
    "investments": "1200",
    "other": "0",
    "withheld": "10000"
  },
  "deductions": {
    "retirement": "10000",
    "hsa": "0",
    "studentLoanInterest": "1500",
    "selfEmpHealth": "0",
    "mortgage": "0",
    "stateTaxes": "0",
    "charitableCash": "500",
    "medicalExpenses": "0"
  },
  "credits": {
    "childTax": true,
    "childCare": false,
    "eitc": false,
    "educationCredit": false,
    "llc": false,
    "saverCredit": false,
    "solarCredit": false,
    "energyCredit": false,
    "evCredit": false
  }
}
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "year": 2024,
    "gross": 76200,
    "agi": 64700,
    "taxable": 50100,
    "fed_tax": 2178,
    "withheld": 10000,
    "balance": 7822,
    "is_refund": true,
    "eff_rate": 2.9,
    "marginal_rate": 0.22,
    "bracket_detail": [...],
    "suggestions": [...],
    ...
  }
}
```

### `GET /api/tax_years`

Returns the supported tax years and their key IRS limits (brackets, standard deductions, contribution limits, EITC thresholds).

---

## ⚠️ Disclaimer

**This tool provides estimates for federal income tax only.** It does not account for state or local taxes, AMT, NIIT (3.8%), passive activity rules, phase-outs, or other special circumstances. Always consult a qualified CPA for your actual tax return.

---

## 📄 License

MIT — do whatever you want with it.
