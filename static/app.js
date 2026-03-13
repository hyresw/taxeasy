// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const STEPS = [
  { label: 'Filing Status', icon: '👤' },
  { label: 'Income',        icon: '💼' },
  { label: 'Deductions',    icon: '🧾' },
  { label: 'Credits',       icon: '⭐' },
  { label: 'Summary',       icon: '📊' },
];

// Year limits fetched from /api/tax_years on boot
let YD = {};

// ─── STATE ───────────────────────────────────────────────────────────────────
let taxYear = 2024, step = 0;
let S = freshState();

function freshState() {
  return {
    filing:     { status: '', dependents: '', age: '' },
    income:     { wages: '', selfEmployed: '', investments: '', other: '', withheld: '' },
    deductions: { retirement: '', hsa: '', studentLoanInterest: '', selfEmpHealth: '',
                  mortgage: '', stateTaxes: '', charitableCash: '', medicalExpenses: '' },
    credits:    { childTax: false, childCare: false, eitc: false, educationCredit: false,
                  llc: false, saverCredit: false, solarCredit: false, energyCredit: false, evCredit: false },
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const p      = v => Math.max(0, parseFloat(v) || 0);
const filled = v => typeof v === 'string' && v.trim() !== '';
const fmt    = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const pct    = r => (r * 100).toFixed(0) + '%';
const esc    = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function yd() { return YD[taxYear] || {}; }

// ─── FIELD VALIDATION RULES ──────────────────────────────────────────────────
// Each rule: maxKey (property of yd()), max (fixed), warnThreshold, min
const FIELD_RULES = {
  'deductions_retirement':          { maxKey: 'k401_limit',  msg: (lim) => `Exceeds the ${taxYear} 401(k) limit of ${fmt(lim)}. We'll cap it at ${fmt(lim)} in the calculation.` },
  'deductions_hsa':                 { maxKey: 'hsa_fam',     msg: (lim) => `Exceeds the ${taxYear} family HSA limit of ${fmt(lim)}. We'll cap it at ${fmt(lim)} in the calculation.` },
  'deductions_studentLoanInterest': { max: 2500,             msg: ()    => `The student loan interest deduction is capped at ${fmt(2500)} by the IRS. We'll cap it automatically.` },
  'deductions_stateTaxes':          { warnThreshold: 10000,  warnMsg: () => `The SALT deduction is capped at ${fmt(10000)} federally. Any amount above that won't reduce your taxes further.` },
  'filing_age':                     { max: 120, min: 1,      msg: ()    => `Please enter a valid age between 1 and 120.` },
  'filing_dependents':              { max: 20,  min: 0,      msg: ()    => `Please enter a number between 0 and 20.` },
  'income_wages':                   { warnThreshold: 1000000, warnMsg: () => `That's over $1,000,000 — double-check this figure.` },
  'income_selfEmployed':            { warnThreshold: 500000,  warnMsg: () => `That's over $500,000 in self-employment income — double-check this figure.` },
};

function getFieldValidation(id, value) {
  const rule = FIELD_RULES[id];
  if (!rule || !filled(value)) return { type: null };
  const v = p(value);
  const ydata = yd();
  const hardMax = rule.max !== undefined ? rule.max : rule.maxKey ? (ydata[rule.maxKey] || Infinity) : Infinity;
  if (v > hardMax) return { type: 'error', message: rule.msg(hardMax) };
  if (rule.min !== undefined && v < rule.min) return { type: 'error', message: rule.msg(hardMax) };
  if (rule.warnThreshold !== undefined && v > rule.warnThreshold) return { type: 'warn', message: rule.warnMsg() };
  return { type: null };
}

function validateField(id, value) {
  const field = document.querySelector('[data-field-id="' + id + '"]');
  if (!field) return;
  const wrap = field.querySelector('.input-wrap');
  const msg  = field.querySelector('.field-msg');
  if (!wrap || !msg) return;
  const res = getFieldValidation(id, value);
  wrap.classList.toggle('has-error', res.type === 'error');
  wrap.classList.toggle('has-warn',  res.type === 'warn');
  if (res.type === 'error') {
    msg.className = 'field-msg error';
    msg.innerHTML = '<span class="field-msg-ico">⚠️</span><span>' + res.message + '</span>';
  } else if (res.type === 'warn') {
    msg.className = 'field-msg warn';
    msg.innerHTML = '<span class="field-msg-ico">💡</span><span>' + res.message + '</span>';
  } else {
    msg.className = 'field-msg';
    msg.innerHTML = '';
  }
}

function validateAllVisible() {
  Object.keys(FIELD_RULES).forEach(function(id) {
    var parts = id.split('_');
    var sec = parts[0];
    var key = parts.slice(1).join('_');
    var val = S[sec] && S[sec][key];
    if (val !== undefined) validateField(id, val);
  });
}


// ─── API ─────────────────────────────────────────────────────────────────────
async function apiCalculate() {
  const res = await fetch('/api/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taxYear, ...S }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data.result;
}

// ─── TOOLTIP HELPER ──────────────────────────────────────────────────────────
function tt(text, example) {
  const eg = example ? `<div class="tip-eg">${example}</div>` : '';
  return `<span class="tip-wrap"><span class="tip-ico">i</span><span class="tip-box">${text}${eg}</span></span>`;
}

// ─── UI COMPONENT BUILDERS ───────────────────────────────────────────────────
function mkField(id, label, hint, pfx, value, tipText, tipExample, liveKey) {
  const hasV = filled(value);
  const tipH = tipText ? tt(tipText, tipExample) : '';
  const v0   = getFieldValidation(id, value);
  const wrapExtra = v0.type === 'error' ? ' has-error' : v0.type === 'warn' ? ' has-warn' : '';
  const msgHtml   = v0.type === 'error'
    ? `<div class="field-msg error"><span class="field-msg-ico">⚠️</span><span>${v0.message}</span></div>`
    : v0.type === 'warn'
    ? `<div class="field-msg warn"><span class="field-msg-ico">💡</span><span>${v0.message}</span></div>`
    : `<div class="field-msg"></div>`;
  return `<div class="field" data-field-id="${id}">
    <div class="field-label${hasV ? ' filled' : ''}">
      ${esc(label)}${tipH}
      <span class="field-check">✓</span>
    </div>
    ${hint ? `<div class="field-hint"${liveKey ? ` data-live="${liveKey}-hint"` : ''}>${hint}</div>` : ''}
    <div class="input-wrap${hasV ? ' filled' : ''}${wrapExtra}">
      ${pfx ? `<span class="input-pfx">${pfx}</span>` : ''}
      <input type="text" inputmode="decimal" value="${esc(value)}" placeholder="0"
        oninput="onInput('${id}',this)"
        onfocus="this.parentElement.classList.add('focused')"
        onblur="this.parentElement.classList.remove('focused')"/>
    </div>
    ${msgHtml}
  </div>`;
}

function mkRadio(value, icon, label, desc, selected, tipText, tipExample) {
  const tipH = tipText ? tt(tipText, tipExample) : '';
  return `<button class="radio-btn${selected ? ' selected' : ''}" onclick="onStatus('${value}')">
    <span class="r-icon">${icon}</span>
    <div class="r-label">${label}${tipH}</div>
    <div class="r-desc">${desc}</div>
  </button>`;
}

function mkToggle(id, label, hint, checked, tipText, tipExample) {
  const tipH = tipText ? tt(tipText, tipExample) : '';
  return `<div class="toggle-row">
    <div class="toggle-text">
      <div class="toggle-label">${label}${tipH}</div>
      ${hint ? `<div class="toggle-hint">${hint}</div>` : ''}
    </div>
    <button class="sw${checked ? ' on' : ''}" id="sw-${id}" onclick="onToggle('${id}')">
      <div class="knob"></div>
    </button>
  </div>`;
}

function mkBanner(text, color) {
  color = color || '#2DD4BF';
  return `<div class="tip-banner" style="background:${color}12;border:1px solid ${color}28">
    <span class="tb-ico">💡</span><span>${text}</span>
  </div>`;
}

function mkCard(title, content) {
  return `<div class="icard"><div class="icard-title">${title}</div>${content}</div>`;
}

// ─── INPUT / STATE HANDLERS ──────────────────────────────────────────────────
function onInput(id, el) {
  // Strip everything except digits and decimal point.
  // If the user typed a minus sign, show a friendly shake instead.
  if (el.value.includes('-')) {
    el.value = el.value.replace(/-/g, '');
    shakeField(el);
  }
  let v = el.value.replace(/[^0-9.]/g, '');
  const pts = v.split('.');
  if (pts.length > 2) v = pts[0] + '.' + pts.slice(1).join('');
  el.value = v;
  const [sec, ...rest] = id.split('_');
  if (S[sec]) S[sec][rest.join('_')] = v;
  const hasV = filled(v);
  el.parentElement.classList.toggle('filled', hasV);
  el.closest('.field').querySelector('.field-label').classList.toggle('filled', hasV);
  validateField(id, v);   // show/clear error or warning for this field
  if (step === 2) updateDeductionsLive();
  else if (step === 4) paint(4);
  refreshProgress();
}

// Patches only the live-feedback elements in the Deductions step
// (never rebuilds inputs, which would steal focus)
async function updateDeductionsLive() {
  try {
    const r = await apiCalculate();
    const d = S.deductions;
    const ydata = yd();

    // SALT hint
    const saltHint = document.querySelector('[data-live="salt-hint"]');
    if (saltHint) saltHint.textContent =
      `State income tax + property taxes · Capped at $10,000 · Your deductible: ${fmt(r.salt_capped)}`;

    // Medical hint
    const medHint = document.querySelector('[data-live="med-hint"]');
    if (medHint) medHint.textContent =
      `Only the amount above 7.5% of your AGI is deductible · Deductible portion: ${fmt(r.med_deductible)}`;

    // Itemize comparison banner
    const container = document.getElementById('itemize-live');
    if (!container) return;
    if (r.item_tot > 0) {
      const doItem = r.itemizing;
      const col = doItem ? '#2DD4BF' : '#FCD34D';
      const bg  = doItem ? 'rgba(45,212,191,.07)' : 'rgba(251,191,36,.07)';
      const bd  = doItem ? 'rgba(45,212,191,.22)' : 'rgba(251,191,36,.22)';
      container.innerHTML = `<div class="itemize-row" style="background:${bg};border:1px solid ${bd}">
        <div class="ir-title" style="color:${col}">${doItem ? '✅ Itemizing saves you more' : '📋 Standard deduction is higher'}</div>
        <div class="ir-body">Your itemized total: <strong>${fmt(r.item_tot)}</strong> · Standard: <strong>${fmt(r.std_ded)}</strong>
          ${doItem
            ? ` · Itemizing saves an extra <strong class="ir-save">${fmt((r.item_tot - r.std_ded) * r.marginal_rate)}</strong> at your ${pct(r.marginal_rate)} marginal rate.`
            : ' · The standard deduction will be applied automatically on your Summary.'}
        </div>
      </div>`;
    } else {
      container.innerHTML = '';
    }
  } catch (e) {
    console.error('Live update failed:', e);
  }
}

function onStatus(val) {
  S.filing.status = val;
  paint(0);
  refreshProgress();
}

function onToggle(id) {
  const [sec, ...rest] = id.split('_');
  const key = rest.join('_');
  if (S[sec]) S[sec][key] = !S[sec][key];
  const sw = document.getElementById('sw-' + id);
  if (sw) sw.classList.toggle('on', S[sec][key]);
  if (step === 4) paint(4);
  refreshProgress();
}

function setYear(yr) {
  taxYear = yr;
  paint(step);
  refreshProgress();
  // Re-validate all fields — limits change per year (e.g. 401k cap differs)
  setTimeout(validateAllVisible, 0);
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
const visited = new Set();
function go(i) {
  // Block moving forward from Filing Status if no status chosen
  if (i > step && step === 0 && !S.filing.status) {
    flashRequiredStatus();
    return;
  }
  visited.add(step);
  document.getElementById('p' + step).classList.add('hidden');
  step = i;
  document.getElementById('p' + step).classList.remove('hidden');
  paint(step);
  drawNav();
  refreshProgress();
  document.getElementById('scroll').scrollTop = 0;
}

function flashRequiredStatus() {
  // Pulse the radio grid with a red outline to show the user what's needed
  const grid = document.querySelector('.radio-grid');
  if (!grid) return;
  grid.classList.remove('pulse-required');
  void grid.offsetWidth; // force reflow to restart animation
  grid.classList.add('pulse-required');
  // Show inline toast message
  let toast = document.getElementById('status-required-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'status-required-toast';
    toast.className = 'field-msg error';
    toast.style.cssText = 'margin-top:8px;margin-bottom:4px';
    toast.innerHTML = '<span class="field-msg-ico">⚠️</span><span>Please choose a filing status before continuing.</span>';
    grid.insertAdjacentElement('afterend', toast);
  }
  toast.style.display = 'flex';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 4000);
}

// Steps 0+1 are required — done at 80%. Steps 2+3 are optional — done at ~40%
function doneThreshold(i) { return i <= 1 ? 0.8 : 0.4; }

function completeness(i) {
  switch (i) {
    case 0: {
      if (!S.filing.status) return 0;
      let s = 0.8;
      if (filled(S.filing.age)) s += 0.1;
      if (filled(S.filing.dependents)) s += 0.1;
      return Math.min(1, s);
    }
    case 1: {
      const hasIncome = [S.income.wages, S.income.selfEmployed, S.income.investments, S.income.other].some(v => filled(v));
      if (!hasIncome) return 0;
      return filled(S.income.withheld) ? 1 : 0.6;
    }
    case 2: {
      const nFilled = Object.values(S.deductions).filter(v => filled(v)).length;
      return Math.min(1, nFilled / 8);
    }
    case 3: {
      if (visited.has(3)) return 1;
      const toggled = Object.values(S.credits).filter(Boolean).length;
      return Math.min(1, toggled / 9);
    }
    default: return 0;
  }
}

function refreshProgress() {
  const comps = [0, 1, 2, 3].map(i => completeness(i));
  const overall = comps.reduce((a, b) => a + b, 0) / 4;
  document.getElementById('overall-pct').textContent = Math.round(overall * 100) + '% complete';
  document.getElementById('overall-bar').style.width = (overall * 100) + '%';
  STEPS.forEach((_, i) => {
    const el = document.querySelector(`.nav-item[data-i="${i}"]`);
    if (!el) return;
    const isSummary = i === 4;
    const c    = isSummary ? 0 : comps[i];
    const done = !isSummary && c >= doneThreshold(i) && i !== step;
    el.classList.toggle('active', i === step);
    el.classList.toggle('done', done);
    const dot = el.querySelector('.nav-dot');
    if (dot) dot.textContent = done ? '✓' : STEPS[i].icon;
    const mini = el.querySelector('.nav-mini');
    if (mini) mini.style.display = isSummary ? 'none' : '';
    const fill = el.querySelector('.nav-mini-fill');
    if (fill && !isSummary) fill.style.width = (c * 100) + '%';
  });
}

function drawSidebar() {
  document.getElementById('nav-items').innerHTML = STEPS.map((s, i) => {
    const isSummary = i === 4;
    const c    = isSummary ? 0 : completeness(i);
    const done = !isSummary && c >= doneThreshold(i) && i !== step;
    return `<button class="nav-item${i === step ? ' active' : ''}${done ? ' done' : ''}" data-i="${i}" onclick="go(${i})">
      <div class="nav-icon"><span class="nav-dot">${done ? '✓' : s.icon}</span></div>
      <div style="flex:1;min-width:0">
        <span class="nav-label">${s.label}</span>
        ${isSummary ? '' : `<div class="nav-mini"><div class="nav-mini-fill" style="width:${c * 100}%"></div></div>`}
      </div>
    </button>`;
  }).join('');
}

function drawNav() {
  const el = document.getElementById('nav-row');
  const isSummary = step === 4;
  const label = isSummary
    ? '<span class="step-ctr">Results</span>'
    : `<span class="step-ctr">Step ${step + 1} / 4</span>`;
  let h = `${label}<span class="nspc"></span>`;
  if (step > 0) h += `<button class="btn-back" onclick="go(${step - 1})">← Back</button>`;
  if (!isSummary) h += `<button class="btn-next" onclick="go(${step + 1})">${step === 3 ? 'See My Results →' : 'Continue →'}</button>`;
  if (isSummary)  h += `<button class="btn-print" onclick="printSummary()">🖨 Print / Save PDF</button>`;
  el.innerHTML = h;
}

function resetApp() {
  visited.clear();
  S = freshState();
  go(0);
}

// ─── PAINT ───────────────────────────────────────────────────────────────────
function paint(i) {
  const el = document.getElementById('p' + i);
  if (i === 0) el.innerHTML = buildFiling();
  else if (i === 1) el.innerHTML = buildIncome();
  else if (i === 2) el.innerHTML = buildDeductions();
  else if (i === 3) el.innerHTML = buildCredits();
  else if (i === 4) paintSummary(el);
}

// ─── STEP 0: FILING ──────────────────────────────────────────────────────────
function buildFiling() {
  const { status, dependents, age } = S.filing;
  const ydata = yd();
  const deps = parseInt(dependents) || 0;
  const ageN = parseInt(age) || 0;
  const stdDeds = ydata.std_ded || {};
  const extra65 = ydata.extra_65 || {};
  const base  = stdDeds[status] || stdDeds['single'] || 0;
  const bonus = ageN >= 65 ? (extra65[status] || 1950) : 0;

  return `
  <div class="step-title">👤 Filing Status</div>
  <div class="step-desc">Your filing status sets your tax bracket and standard deduction. Choose what was true on <strong>December 31, ${taxYear}</strong>.</div>

  <div class="radio-grid">
    ${mkRadio('single', '🧑', 'Single', 'Unmarried or legally separated', status === 'single',
      'You file on your own. Use this if none of the other statuses apply to you.',
      '<b>Example:</b> You rent an apartment alone, or share a place with a roommate but do not financially support any dependents.')}
    ${mkRadio('married', '💑', 'Married Jointly', 'Lowest rate for most couples', status === 'married',
      'You and your spouse combine all income on one return. Because the brackets are exactly double the Single brackets, most couples pay less tax this way.',
      `<b>Example:</b> You earn $70k, your spouse earns $50k. Filing jointly uses the wider married brackets and a ${fmt(stdDeds['married'] || 0)} standard deduction.`)}
    ${mkRadio('married_sep', '👫', 'Married Separately', 'Rarely beneficial', status === 'married_sep',
      'Each spouse files their own separate return. This almost always results in a higher combined tax bill. A CPA may recommend it in specific situations such as income-driven student loan repayment plans or liability separation.',
      '<b>Example:</b> Your spouse has large unreimbursed medical expenses they want to keep separate from your income.')}
    ${mkRadio('hoh', '🏠', 'Head of Household', 'Better rate for single parents', status === 'hoh',
      'You must be (1) unmarried on Dec 31, and (2) have paid more than half the cost of keeping up a home for a qualifying person who lived with you for more than half the year.',
      '<b>Example:</b> You are divorced, your child lives with you full-time, and you pay the rent and groceries. You qualify for Head of Household.')}
  </div>

  ${status ? `<div class="std-preview">Your <strong>${taxYear} standard deduction: ${fmt(base)}</strong>${bonus ? ` &nbsp;+&nbsp; <span class="age-bonus">+${fmt(bonus)} age 65+ bonus</span>` : ''}</div>` : ''}

  <div class="two-col">
    ${mkField('filing_dependents', 'Dependents', 'Enter the number of qualifying children or relatives you financially support', '', dependents,
      'A dependent is someone you financially support who meets the IRS relationship and residency tests. There are two categories: Qualifying Child (under 19, or under 24 if a full-time student) and Qualifying Relative (any age if you provide more than half their support).',
      '<b>Examples:</b> Your 15-year-old child, a college student you fully support, or an elderly parent who lives with you and cannot support themselves.')}
    ${mkField('filing_age', 'Your age', 'Taxpayers 65 or older receive an extra standard deduction automatically', '', age,
      `If you turn 65 at any point during the tax year — even on December 31 — you qualify for the additional standard deduction. You do not need to do anything extra; it is applied automatically.`,
      `<b>Example:</b> Born June 1959? You turned 65 during ${taxYear} and qualify for an extra +${fmt(extra65[status] || 1950)} on top of your standard deduction.`)}
  </div>

  ${deps > 0 ? mkBanner(`With ${deps} dependent${deps > 1 ? 's' : ''}, you likely qualify for the <strong>Child Tax Credit</strong> (up to ${fmt(Math.min(deps, 10) * 2000)}). Go to the Credits step to claim it.`) : ''}
  ${ageN >= 65 ? mkBanner(`Age 65+ bonus: <strong>+${fmt(bonus)}</strong> added to your standard deduction automatically.`, '#818CF8') : ''}`;
}

// ─── STEP 1: INCOME ──────────────────────────────────────────────────────────
function buildIncome() {
  const { wages, selfEmployed, investments, other, withheld } = S.income;
  const gross = p(wages) + p(selfEmployed) + p(investments) + p(other);

  return `
  <div class="step-title">💼 Income</div>
  <div class="step-desc">Enter your total income for <strong>${taxYear}</strong>. Include all sources — we'll handle the math.</div>

  <div class="two-col">
    ${mkField('income_wages', 'W-2 Wages & Salary', 'From Box 1 of your W-2 form(s)', '$', wages,
      'Your total wages, salaries, and tips reported by your employer(s) on Form W-2. Use Box 1 of each W-2. If you had multiple jobs, add all Box 1 amounts together.',
      '<b>Where to find it:</b> Box 1 of your W-2. Example: Two W-2s with Box 1 showing $42,000 and $18,000 → enter $60,000.')}
    ${mkField('income_selfEmployed', 'Self-Employment / Freelance', 'Net profit after business expenses — from Schedule C', '$', selfEmployed,
      'Your net self-employment income after deducting all legitimate business expenses. If you received a 1099-NEC, your net profit is the 1099 amount minus business expenses. You owe self-employment tax (15.3%) on this income.',
      '<b>Example:</b> You freelanced and earned $30,000 on 1099s. After deducting $5,000 in business expenses, your net profit is $25,000. Enter $25,000.')}
    ${mkField('income_investments', 'Investment Income', 'Dividends, capital gains distributions, interest — from 1099-DIV/B', '$', investments,
      'Include ordinary dividends, taxable interest, and net capital gains. Check Box 1a on Form 1099-DIV for total ordinary dividends and Schedule D for capital gains. Long-term gains may be taxed at a lower rate — this estimator applies standard income rates.',
      '<b>Examples:</b> $1,200 in dividend income from a brokerage account, $800 interest from a CD, or $5,000 net gain from selling stocks held over a year.')}
    ${mkField('income_other', 'Other Income', 'Rental income, alimony, prizes, unemployment — anything not above', '$', other,
      'Any taxable income not covered by the categories above. Common examples include: rental income (net of expenses), alimony received (pre-2019 divorces), gambling winnings, jury duty pay, Social Security benefits (if taxable), and unemployment compensation.',
      '<b>Examples:</b> $12,000 net rental income after expenses, $3,200 in unemployment benefits, or $500 in gambling winnings.')}
  </div>

  ${gross > 0 ? `<div class="gross-total"><span class="gross-lbl">TOTAL GROSS INCOME</span><span class="gross-val">${fmt(gross)}</span></div>` : ''}

  <div class="withheld-sep">
    ${mkField('income_withheld', 'Federal Tax Withheld', 'From Box 2 of all your W-2s and Box 4 of 1099s — optional but needed for refund estimate', '$', withheld,
      'The total amount of federal income tax your employer(s) already sent to the IRS on your behalf throughout the year. Find this on Box 2 of each W-2. Adding this unlocks your estimated refund or balance due on the Summary screen.',
      '<b>Where to find it:</b> Box 2 of each W-2, plus Box 4 of any 1099-Rs. Add them all up. Example: W-2 Box 2 shows $8,400 → enter $8,400.')}
    <div class="withheld-note">💡 <strong>Optional but useful:</strong> Without this we show your total tax owed. Add it to see whether you'll get a refund or owe more at filing time.</div>
  </div>`;
}

// ─── STEP 2: DEDUCTIONS ──────────────────────────────────────────────────────
function buildDeductions() {
  const { filing: f, income: inc, deductions: d } = S;
  const ydata = yd();
  const stdDeds = ydata.std_ded || {};
  const status = f.status;
  const age = parseInt(f.age) || 0;
  const base = stdDeds[status] || stdDeds['single'] || 14600;
  const extra65 = ydata.extra_65 || {};
  const std  = base + (age >= 65 ? (extra65[status] || 1950) : 0);
  const salt = Math.min(p(d.stateTaxes), 10000);
  const gross = p(inc.wages) + p(inc.selfEmployed) + p(inc.investments) + p(inc.other);
  const aboveLine = Math.min(p(d.retirement), ydata.k401_limit || 23000)
                  + Math.min(p(d.hsa), ydata.hsa_fam || 8300)
                  + Math.min(p(d.studentLoanInterest), 2500)
                  + p(d.selfEmpHealth);
  const agiEst = Math.max(0, gross - aboveLine);
  const medD   = Math.max(0, p(d.medicalExpenses) - agiEst * 0.075);
  const itemTot = p(d.mortgage) + salt + p(d.charitableCash) + medD;
  const doItem  = itemTot > std;
  const mr = getMR(Math.max(0, agiEst - Math.max(std, itemTot)), ydata, status);

  const k401Limit  = ydata.k401_limit  || 23000;
  const iraLimit   = ydata.ira_limit   || 7000;
  const hsaSelf    = ydata.hsa_self    || 4150;
  const hsaFam     = ydata.hsa_fam     || 8300;

  const aboveContent =
    mkField('deductions_retirement', '401(k) / IRA Contributions',
      `${taxYear} max: 401k ${fmt(k401Limit)} · IRA ${fmt(iraLimit)}`,
      '$', d.retirement,
      'Pre-tax contributions to a traditional 401(k) or traditional IRA are subtracted from your taxable income. Roth contributions do NOT qualify — they are already after-tax. If your employer contributed to your 401(k), do not include that here.',
      `<b>Example:</b> You contributed $10,000 to your traditional 401(k) this year. That reduces your taxable income by $10,000, saving roughly ${fmt(10000 * 0.22)} in tax if you are in the 22% bracket.`) +
    mkField('deductions_hsa', 'HSA Contributions',
      `Self-only: ${fmt(hsaSelf)} · Family: ${fmt(hsaFam)} · Must have an HDHP`,
      '$', d.hsa,
      'Only include contributions you deposited directly into your HSA bank account. If your contributions went through payroll (pre-tax), they are already excluded from your W-2 Box 1 wages and should NOT be entered here again.',
      '<b>Requires:</b> You must be enrolled in a High-Deductible Health Plan (HDHP). <b>Example:</b> You transferred $2,500 from your checking account into your HSA — enter $2,500 here.') +
    mkField('deductions_studentLoanInterest', 'Student Loan Interest',
      'Up to $2,500 deductible · phases out at higher incomes',
      '$', d.studentLoanInterest,
      'You can deduct the interest (not principal) you paid on qualifying student loans. Your loan servicer sends Form 1098-E each January. The deduction phases out starting at $75k (single) or $155k (married) and disappears above $90k / $185k.',
      '<b>Example:</b> Your monthly payment is $350 ($220 principal + $130 interest). Over the year you paid $1,560 in interest. Enter $1,560 — under the $2,500 cap.') +
    mkField('deductions_selfEmpHealth', 'Self-Employed Health Insurance',
      '100% deductible if you have net self-employment profit',
      '$', d.selfEmpHealth,
      'If you are self-employed and paid premiums for your own health, dental, or vision insurance — not through an employer — the full cost is deductible. The deduction cannot exceed your net self-employment profit.',
      '<b>Example:</b> You are a freelancer who bought a marketplace plan for $480/month ($5,760/year). Enter $5,760 here.');

  const itemContent =
    mkField('deductions_mortgage', 'Mortgage Interest Paid',
      'From Form 1098 sent by your lender each January',
      '$', d.mortgage,
      'The interest you paid on a home mortgage during the year. Your lender sends Form 1098 showing the amount. Only interest counts — not principal payments, homeowner\'s insurance, or property taxes (those go in SALT below).',
      '<b>Where to find it:</b> Box 1 of Form 1098 from your mortgage servicer. Example: Your $2,000/month payment includes $1,600 interest. Annual interest ≈ $19,200.') +
    mkField('deductions_stateTaxes', 'State & Local Taxes (SALT)',
      `State income tax + property taxes · Capped at $10,000 · Your deductible: ${fmt(salt)}`,
      '$', d.stateTaxes,
      'Combine your state income taxes paid and local property taxes for the year. The federal deduction is hard-capped at $10,000 per household regardless of the total you paid. You cannot deduct sales tax if you claim income tax.',
      '<b>Example:</b> You paid $6,500 in state income taxes and $7,200 in property taxes. Total $13,700 — but only $10,000 is deductible. Enter $13,700 and the cap is applied automatically.',
      'salt') +
    mkField('deductions_charitableCash', 'Charitable Donations',
      'Cash, check, or card donations to qualified 501(c)(3) organizations',
      '$', d.charitableCash,
      'Add up all cash or card donations you made to IRS-approved charities. Keep records (bank statements, receipts). For any single donation of $250 or more, you need a written acknowledgment from the charity.',
      '<b>Examples:</b> $600 donated to your local food bank, $1,200 to your church, $300 to a national disaster relief fund. Total = $2,100.') +
    mkField('deductions_medicalExpenses', 'Medical & Dental Expenses',
      `Only the amount above 7.5% of your AGI is deductible · Deductible portion: ${fmt(medD)}`,
      '$', d.medicalExpenses,
      'Out-of-pocket medical costs NOT reimbursed by insurance. Only the amount exceeding 7.5% of your AGI is deductible. This threshold means the deduction is only useful if you had unusually high medical bills.',
      `<b>Example:</b> Your AGI is $60,000 · 7.5% floor = $4,500. You paid $9,000 out-of-pocket for a surgery. Deductible portion = $9,000 − $4,500 = <strong>$4,500</strong>. Enter the full $9,000 and we calculate the rest.`,
      'med');

  let html = `
  <div class="step-title">🧾 Deductions</div>
  <div class="step-desc">Deductions reduce taxable income. You always get the <strong style="color:#2DD4BF">standard deduction (${fmt(std)})</strong> for free — fill in below only if your total expenses might exceed it.</div>
  <div class="two-col">
    <div>${mkCard('ABOVE-THE-LINE — Deductible even if you take the standard deduction', aboveContent)}</div>
    <div>${mkCard(`ITEMIZED — Only beneficial if your total exceeds the ${fmt(std)} standard deduction`, itemContent)}</div>
  </div>`;

  if (itemTot > 0) {
    const col = doItem ? '#2DD4BF' : '#FCD34D';
    const bg  = doItem ? 'rgba(45,212,191,.07)' : 'rgba(251,191,36,.07)';
    const bd  = doItem ? 'rgba(45,212,191,.22)' : 'rgba(251,191,36,.22)';
    html += `<div id="itemize-live"><div class="itemize-row" style="background:${bg};border:1px solid ${bd}">
      <div class="ir-title" style="color:${col}">${doItem ? '✅ Itemizing saves you more' : '📋 Standard deduction is higher'}</div>
      <div class="ir-body">Your itemized total: <strong>${fmt(itemTot)}</strong> · Standard: <strong>${fmt(std)}</strong>
        ${doItem
          ? ` · Itemizing saves an extra <strong class="ir-save">${fmt((itemTot - std) * mr)}</strong> at your ${pct(mr)} marginal rate.`
          : ' · The standard deduction will be applied automatically on your Summary.'}
      </div>
    </div></div>`;
  } else {
    html += `<div id="itemize-live"></div>`;
  }
  html += mkBanner(`<strong>Donation bunching tip:</strong> Combine two years of charitable giving into one year via a Donor-Advised Fund to push above ${fmt(std)} and itemize — then take the standard deduction the next year.`, '#818CF8');
  return html;
}

// Client-side marginal rate lookup (for deductions step live preview before API responds)
function getMR(taxable, ydata, status) {
  const key = status === 'married_sep' ? 'single' : status;
  const brackets = (ydata.brackets || {})[key] || (ydata.brackets || {})['single'] || [];
  const b = brackets.find(b => taxable >= b.min && taxable < b.max);
  return b ? b.rate : 0.37;
}

// ─── STEP 3: CREDITS ─────────────────────────────────────────────────────────
function buildCredits() {
  const { credits: c, filing: f } = S;
  const ydata = yd();
  const deps  = parseInt(f.dependents) || 0;
  const eitcAmounts = ydata.eitc_amounts || {};
  const eitcLimits  = ydata.eitc_limits  || {};

  // EITC eligibility warning
  const gross = p(S.income.wages) + p(S.income.selfEmployed) + p(S.income.investments) + p(S.income.other);
  const eitcLim = (eitcLimits[S.filing.status === 'married' ? 'married' : 'single'] || 56838);
  const eitcWarn = (gross > 0 && gross >= eitcLim)
    ? mkBanner(`Your gross income of <strong>${fmt(gross)}</strong> exceeds the ${taxYear} EITC income limit of <strong>${fmt(eitcLim)}</strong> for your filing status — you likely won't qualify for the Earned Income Credit.`, '#F87171')
    : '';

  return `
  <div class="step-title">⭐ Tax Credits</div>
  <div class="step-desc">Credits are <strong style="color:#2DD4BF">dollar-for-dollar reductions</strong> of your tax bill — more powerful than deductions. Toggle any that apply to your situation this year.</div>
  ${eitcWarn}
  <div class="credits-grid">

    <div class="credits-col">
      <div class="credits-col-title">FAMILY &amp; CHILDREN</div>
      ${mkToggle('credits_childTax', 'Child Tax Credit',
        deps > 0 ? `$2,000 per qualifying child under 17 · potential: ${fmt(Math.min(deps, 10) * 2000)}` : 'Requires at least one child under age 17',
        c.childTax,
        'Worth $2,000 per qualifying child under age 17 who lived with you for more than half the year. Up to $1,700 per child may be refundable (returned to you even if your tax bill is $0).',
        `<b>Example:</b> 2 kids under 17 → up to $4,000 credit. If your final tax is $2,800, the credit zeroes your bill and you may receive the remaining $1,200 as a refund.`)}
      ${mkToggle('credits_childCare', 'Child &amp; Dependent Care',
        'Up to $1,050 (1 child) or $2,100 (2+ children) for qualified care expenses',
        c.childCare,
        'If you paid for childcare for a child under 13 — or for a disabled dependent — while you worked or looked for work, you can claim 20–35% of up to $3,000 (1 child) or $6,000 (2+ children) in expenses.',
        '<b>Qualifying expenses:</b> Daycare center, after-school programs, summer day camp, babysitter, or home health aide for a disabled dependent. Overnight camps and tutoring do not qualify.')}
      ${mkToggle('credits_eitc', 'Earned Income Credit (EITC)',
        `For lower-to-moderate earners · up to ${fmt(eitcAmounts[3] || eitcAmounts['3'] || 7430)} with 3+ kids`,
        c.eitc,
        'A refundable credit — meaning you get the money back even if you owe no tax. The amount depends on your income, filing status, and number of children. You must have earned income (wages or self-employment).',
        `<b>${taxYear} income limits:</b> Single/HoH ~${fmt(eitcLimits['single'] || 56838)}, Married ~${fmt(eitcLimits['married'] || 63398)}. Even people with no children can qualify for ~${fmt(eitcAmounts[0] || eitcAmounts['0'] || 632)} if their income is low enough.`)}
    </div>

    <div class="credits-col">
      <div class="credits-col-title">EDUCATION</div>
      ${mkToggle('credits_educationCredit', 'American Opportunity Credit',
        'Up to $2,500/year · first 4 years of college · 40% refundable',
        c.educationCredit,
        'Worth 100% of the first $2,000 plus 25% of the next $2,000 in tuition and required fees — max $2,500 per eligible student per year. Only for the first four years of undergraduate study. 40% ($1,000 max) is refundable.',
        '<b>Example:</b> Your child\'s tuition is $8,000. The credit is $2,500. If your tax bill is $1,800, the credit zeros it out and you receive the remaining $700 as a refund (40% refundable portion).')}
      ${mkToggle('credits_llc', 'Lifetime Learning Credit',
        '20% of up to $10,000 in tuition · no limit on years of school',
        c.llc,
        'Worth 20% of up to $10,000 in qualified tuition and fees — max $2,000 per return. Unlike the American Opportunity Credit, there is no four-year limit. It can be used for graduate school, professional development, or a single continuing-education class.',
        '<b>Example:</b> You took an online MBA course for $6,000. Credit = $6,000 × 20% = $1,200 off your tax bill. You cannot claim both this and the American Opportunity Credit in the same year.')}
      <div class="credits-sub-title">RETIREMENT</div>
      ${mkToggle('credits_saverCredit', "Saver's Credit",
        'Up to $1,000 for retirement contributions · income limits apply',
        c.saverCredit,
        'Also called the Retirement Savings Contributions Credit. For lower-income workers who contribute to a 401(k), IRA, or similar plan. The credit is 10–50% of your contribution up to $2,000, depending on your income.',
        `<b>${taxYear} income limits:</b> Single < ~$36,500, Married < ~$73,000. <b>Example:</b> You earn $28,000 single and contributed $1,500 to a Roth IRA. You may qualify for a $750 credit on top of the tax-free growth benefit.`)}
    </div>

    <div class="credits-col">
      <div class="credits-col-title">HOME &amp; ENERGY</div>
      ${mkToggle('credits_solarCredit', 'Residential Clean Energy Credit',
        '30% of solar, battery storage, or geothermal system cost · no dollar cap',
        c.solarCredit,
        'You can claim 30% of the total installed cost of solar panels, battery storage systems, solar water heaters, geothermal heat pumps, or small wind turbines at your primary or secondary residence. Unused credit carries forward to future years.',
        '<b>Example:</b> Solar panels cost $18,000 installed. Credit = $5,400. If your tax bill is $3,200, the credit wipes it out and the remaining $2,200 carries forward to next year.')}
      ${mkToggle('credits_energyCredit', 'Home Energy Improvement Credit',
        'Up to $3,200/year for insulation, heat pumps, windows, EV chargers',
        c.energyCredit,
        'Worth 30% of eligible home energy improvement costs, up to $3,200 per year. Sub-limits apply: $1,200 for insulation, windows, doors, and non-heat-pump HVAC; $2,000 for heat pumps. Must be installed at your primary U.S. residence.',
        '<b>Examples:</b> New heat pump ($2,000 max credit), attic insulation + energy-efficient windows (~$600 combined), Level 2 EV charger installation (~$300, part of the $1,200 sub-cap).')}
      ${mkToggle('credits_evCredit', 'Electric Vehicle (EV) Credit',
        'Up to $7,500 new EV · $4,000 used EV from a dealer · income limits apply',
        c.evCredit,
        'The Clean Vehicle Credit is up to $7,500 for a qualifying new EV and up to $4,000 (or 30% of price, whichever is less) for a qualifying used EV purchased from a licensed dealer.',
        '<b>Income limits (new EV):</b> Single < $150k, Married < $300k. <b>Example:</b> You bought a qualifying EV for $42,000. Credit = $7,500. This directly reduces your tax bill dollar-for-dollar — but it is not refundable if it exceeds what you owe.')}
    </div>
  </div>`;
}

// ─── STEP 4: SUMMARY (async — calls Python API) ───────────────────────────────
async function paintSummary(el) {
  el.innerHTML = `<div class="step-title">📊 Tax Summary — ${taxYear}</div>
    <div class="step-desc" style="margin-top:8px">Calculating your estimate…</div>`;
  try {
    const T = await apiCalculate();
    el.innerHTML = buildSummary(T);
  } catch (e) {
    el.innerHTML = `<div class="step-title">📊 Tax Summary</div>
      <div class="step-desc" style="color:#F87171">Error calculating taxes: ${esc(e.message)}</div>`;
  }
}

function buildSummary(T) {
  const BC = ['#34D399','#2DD4BF','#60A5FA','#818CF8','#F59E0B','#F87171','#EC4899'];
  const effRate = T.eff_rate;
  const mrPct   = pct(T.marginal_rate);

  const stats = [
    { l: 'GROSS INCOME',    v: fmt(T.gross),         c: '#E2E8F0' },
    { l: 'AGI ADJUSTMENTS', v: `−${fmt(T.agi_adj)}`, c: '#818CF8' },
    { l: 'ADJUSTED GROSS',  v: fmt(T.agi),            c: '#E2E8F0' },
    { l: T.itemizing ? 'ITEMIZED DED.' : 'STANDARD DED.', v: `−${fmt(T.ded_used)}`, c: '#818CF8', s: T.itemizing ? 'Itemizing ✓' : 'Standard' },
    { l: 'TAXABLE INCOME',  v: fmt(T.taxable),        c: '#2DD4BF' },
    { l: 'INCOME TAX',      v: fmt(T.inc_tax),        c: '#F87171' },
  ];
  if (T.se_tax > 0)   stats.push({ l: 'SE TAX (15.3%)', v: fmt(T.se_tax),         c: '#FB923C' });
  if (T.credits > 0)  stats.push({ l: 'CREDITS',        v: `−${fmt(T.credits)}`,  c: '#34D399' });
  stats.push(          { l: 'FINAL TAX',       v: fmt(T.fed_tax),        c: '#2DD4BF' });

  const refundBlock = T.withheld > 0 ? `
    <div class="wf-refund">
      <div class="refund-hero" style="background:${T.is_refund
        ? 'linear-gradient(135deg,rgba(52,211,153,.12),rgba(45,212,191,.06))'
        : 'linear-gradient(135deg,rgba(248,113,113,.12),rgba(251,146,60,.06))'};border:1px solid ${T.is_refund ? 'rgba(52,211,153,.24)' : 'rgba(248,113,113,.24)'}">
        <div class="refund-lbl">${T.is_refund ? 'ESTIMATED REFUND' : 'AMOUNT OWED'}</div>
        <div class="refund-amt" style="color:${T.is_refund ? '#34D399' : '#F87171'}">${fmt(Math.abs(T.balance))}</div>
        <div class="refund-sub">${fmt(T.withheld)} withheld · ${fmt(T.fed_tax)} owed${T.is_refund
          ? ` → <strong style="color:#34D399">${fmt(T.balance)} back</strong>`
          : ` → <strong style="color:#F87171">${fmt(Math.abs(T.balance))} due</strong>`}</div>
      </div>
    </div>` : '';

  const hasBd = T.bracket_detail && T.bracket_detail.length > 0;
  const bracketBlock = hasBd ? `
    <div class="icard" style="margin-bottom:0">
      <div class="icard-title">HOW YOUR INCOME IS TAXED — BRACKET BY BRACKET</div>
      ${T.bracket_detail.map((b, i) => {
        const w = T.taxable > 0 ? (b.in_bracket / T.taxable * 100).toFixed(1) : 0;
        const col = BC[i % BC.length];
        return `<div class="br-row">
          <div class="br-head">
            <span class="br-name" style="color:${col}">${b.label} bracket</span>
            <span class="br-amt">${fmt(b.in_bracket)} → <strong>${fmt(b.tax)}</strong></span>
          </div>
          <div class="br-outer"><div class="br-inner" style="width:${w}%;background:${col}"></div></div>
        </div>`;
      }).join('')}
      <p class="br-note">ℹ️ Only the income within each bracket is taxed at that rate — your entire income is not taxed at your top rate.</p>
    </div>` : '';

  const sg = T.suggestions || [];
  const bottomClass = hasBd ? 'sum-bottom' : 'sum-bottom full';

  return `
  <div class="step-title">📊 Tax Summary — ${T.year}</div>
  <div class="step-desc">Your complete estimated federal tax picture for ${T.year}, plus personalised ways to lower your bill.</div>

  <div class="wfall">
    <div class="wfall-inner">
      <div class="wf-main">
        <div class="tax-total-lbl">TOTAL FEDERAL TAX · ${T.year}</div>
        <div class="tax-total-amt">${fmt(T.fed_tax)}</div>
        <div class="tax-rates">Effective rate <strong>${effRate}%</strong> &nbsp;·&nbsp; Marginal rate <strong>${mrPct}</strong></div>
        <div class="stat-grid">
          ${stats.map(s => `<div class="stat-box">
            <div class="sv" style="color:${s.c}">${s.v}</div>
            <div class="sl">${s.l}</div>${s.s ? `<div class="ss">${s.s}</div>` : ''}
          </div>`).join('')}
        </div>
      </div>
      ${refundBlock}
    </div>
  </div>

  <div class="${bottomClass}">
    ${bracketBlock}
    <div>
      ${sg.length > 0 ? `<div class="sugg-lbl">💰 PERSONALISED TAX-SAVING OPPORTUNITIES</div>
        ${sg.map(s => `<div class="sugg" style="background:${s.color}09;border:1px solid ${s.color}22">
          <span class="sugg-ico">${s.icon}</span>
          <div><div class="sugg-title" style="color:${s.color}">${esc(s.title)}</div>
          <div class="sugg-desc">${esc(s.desc)}</div></div>
        </div>`).join('')}` : ''}
      <div class="disclaimer"><p>⚠️ <strong>Estimate only — federal income tax only.</strong> Does not include state taxes, AMT, NIIT (3.8%), or other special circumstances. Consult a CPA for your actual filing.</p></div>
    </div>
  </div>`;
}

// ─── SHAKE ANIMATION (negative number feedback) ──────────────────────────────
function shakeField(input) {
  const wrap = input.closest('.input-wrap');
  if (!wrap) return;
  wrap.classList.remove('shake');
  void wrap.offsetWidth;
  wrap.classList.add('shake');
  setTimeout(() => wrap.classList.remove('shake'), 500);
}

// ─── PRINT / EXPORT SUMMARY ──────────────────────────────────────────────────
async function printSummary() {
  let T;
  try { T = await apiCalculate(); } catch(e) { alert('Calculation error: ' + e.message); return; }

  const fmt2 = n => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
  const pct2 = r => (r*100).toFixed(0) + '%';
  const status_labels = {single:'Single',married:'Married Filing Jointly',married_sep:'Married Filing Separately',hoh:'Head of Household'};
  const statusLabel = status_labels[S.filing.status] || S.filing.status;

  const rows = [
    ['Gross Income',       fmt2(T.gross)],
    ['AGI Adjustments',    '− ' + fmt2(T.agi_adj)],
    ['Adjusted Gross Income', fmt2(T.agi)],
    [T.itemizing ? 'Itemized Deduction' : 'Standard Deduction', '− ' + fmt2(T.ded_used)],
    ['Taxable Income',     fmt2(T.taxable)],
    ['Income Tax',         fmt2(T.inc_tax)],
    ...(T.se_tax > 0 ? [['Self-Employment Tax', fmt2(T.se_tax)]] : []),
    ...(T.credits > 0 ? [['Tax Credits', '− ' + fmt2(T.credits)]] : []),
    ['Federal Tax Owed',   fmt2(T.fed_tax)],
    ...(T.withheld > 0 ? [['Federal Withheld', fmt2(T.withheld)], [T.is_refund ? 'Estimated Refund' : 'Amount Owed', (T.is_refund ? '+' : '− ') + fmt2(Math.abs(T.balance))]] : []),
  ];

  const bRows = (T.bracket_detail || []).map((b,i) =>
    `<tr><td>${b.label} bracket</td><td>${fmt2(b.in_bracket)}</td><td>${fmt2(b.tax)}</td></tr>`).join('');

  const sgRows = (T.suggestions || []).map(s =>
    `<tr><td><strong>${s.title}</strong><br><span style="color:#555;font-size:12px">${s.desc}</span></td></tr>`).join('');

  const win = window.open('', '_blank', 'width=780,height=900');
  win.document.write(`<!DOCTYPE html><html><head><title>TaxEasy — ${T.year} Tax Summary</title>
  <style>
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;margin:0;padding:32px 40px;font-size:14px}
    h1{font-size:22px;margin:0 0 4px}
    .sub{color:#666;font-size:13px;margin-bottom:24px}
    .meta{display:flex;gap:32px;padding:14px 18px;background:#f4f9ff;border-radius:8px;margin-bottom:24px;font-size:13px}
    .meta-item{display:flex;flex-direction:column}
    .meta-label{color:#888;font-size:11px;margin-bottom:2px;text-transform:uppercase;letter-spacing:.04em}
    .meta-val{font-weight:700;font-size:15px}
    table{width:100%;border-collapse:collapse;margin-bottom:24px}
    th{text-align:left;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;padding:6px 10px;border-bottom:2px solid #e5e7eb}
    td{padding:9px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top}
    tr:last-child td{border-bottom:none}
    td:last-child{text-align:right;font-family:monospace;font-size:13px}
    .highlight td{background:#f0fdf8;font-weight:700}
    .refund td{background:#f0fdf8;color:#059669;font-weight:700}
    .owed td{background:#fff5f5;color:#dc2626;font-weight:700}
    .section-title{font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.07em;margin:20px 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb}
    .disclaimer{margin-top:28px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:11.5px;color:#92400e;line-height:1.6}
    .footer{margin-top:20px;font-size:11px;color:#aaa;text-align:center}
    @media print{body{padding:20px}button{display:none}}
  </style></head><body>
  <h1>TaxEasy — ${T.year} Federal Tax Summary</h1>
  <div class="sub">Estimated federal income tax only · Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div>

  <div class="meta">
    <div class="meta-item"><span class="meta-label">Filing Status</span><span class="meta-val">${statusLabel}</span></div>
    <div class="meta-item"><span class="meta-label">Tax Year</span><span class="meta-val">${T.year}</span></div>
    <div class="meta-item"><span class="meta-label">Effective Rate</span><span class="meta-val">${T.eff_rate}%</span></div>
    <div class="meta-item"><span class="meta-label">Marginal Rate</span><span class="meta-val">${pct2(T.marginal_rate)}</span></div>
    ${S.filing.dependents ? `<div class="meta-item"><span class="meta-label">Dependents</span><span class="meta-val">${S.filing.dependents}</span></div>` : ''}
  </div>

  <div class="section-title">Tax Calculation</div>
  <table>
    <tr><th>Item</th><th>Amount</th></tr>
    ${rows.map((r,i) => `<tr class="${r[0]==='Federal Tax Owed'?'highlight':r[0]==='Estimated Refund'?'refund':r[0]==='Amount Owed'?'owed':''}"><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}
  </table>

  ${bRows ? `<div class="section-title">Bracket Breakdown</div>
  <table><tr><th>Bracket</th><th>Income in Bracket</th><th>Tax</th></tr>${bRows}</table>` : ''}

  ${sgRows ? `<div class="section-title">Tax-Saving Opportunities</div>
  <table><tr><th>Suggestion</th></tr>${sgRows}</table>` : ''}

  <div class="disclaimer">⚠️ <strong>Estimate only.</strong> This summary covers federal income tax only and does not account for state/local taxes, AMT, NIIT (3.8%), phase-outs, or other special circumstances. Consult a qualified CPA or tax professional for your actual filing.</div>
  <div class="footer">Generated by TaxEasy &nbsp;·&nbsp; taxeasy.local</div>

  <script>window.onload = function(){ window.print(); }<\/script>
  </body></html>`);
  win.document.close();
}

// ─── BOOT ────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const res  = await fetch('/api/tax_years');
    const data = await res.json();
    // Store bracket data keyed by integer year for getMR lookups
    for (const [yr, info] of Object.entries(data)) {
      YD[parseInt(yr)] = info;
    }
  } catch (e) {
    console.warn('Could not load tax year data from server:', e);
  }
  drawSidebar();
  paint(0);
  drawNav();
  refreshProgress();
}

boot();
