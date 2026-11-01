#!/usr/bin/env python3
# Run: python3 derived_numbers.py  (no dependencies)
# Derived figures for the Fly91 dossier. Inputs are the sourced figures; outputs are our arithmetic.
print("== Fly91 ==")
pax2y, flights2y, seats = 481_802, 9_569, 70
ppf = pax2y / flights2y
print(f"pax per flight (2y): {ppf:.1f}; implied avg LF at {seats} seats: {ppf/seats:.1%}")
y1 = 170_000
print(f"year-2 pax ~ {pax2y - y1:,}; year-2/year-1 = {(pax2y - y1)/y1:.2f}x (growth {(pax2y - y1)/y1 - 1:.0%})")
print(f"weekly flights 280 -> 354: {354/280-1:.1%}")
for wk, lf in [(280, 0.776), (354, 0.75), (354, 0.776)]:
    monthly = wk * seats * lf * 30/7
    annual = wk * 52 * seats * lf
    print(f"{wk}/wk @ LF {lf:.1%}: ~{monthly:,.0f} pax/month, ~{annual:,.0f} pax/yr; share of Sep-26 market {monthly/11_823_000:.2%}")
print(f"0.2% of Mar-quarter-ish month 1.35cr: {0.002*13_500_000:,.0f} pax/month")
print(f"40-aircraft order vs ATR India 20y forecast (210): {40/210:.0%}; list price per aircraft ~${1e9/40/1e6:.0f}M")
print("== IndiGo (Rs crore) ==")
q = {"Q1FY26": 2176, "Q2FY26": -2582.1, "Q3FY26": 549.8, "Q4FY26": -2536.9, "Q1FY27": -238, "Q2FY27": -1879.1}
fy26 = q["Q1FY26"] + q["Q2FY26"] + q["Q3FY26"] + q["Q4FY26"]
print(f"FY26 sum of quarters: {fy26:,.1f} (reported -2,393.6)")
last4 = q["Q3FY26"] + q["Q4FY26"] + q["Q1FY27"] + q["Q2FY27"]
print(f"last 4 quarters (Q3FY26..Q2FY27): {last4:,.1f}")
print(f"last 5 quarters: {last4 + q['Q2FY26']:,.1f}")
anc, rev, pax = 2480.9, 23363.8, 27.5e6
print(f"Q2FY27 ancillary share of revenue from ops: {anc/rev:.1%}; ancillary per pax: Rs {anc*1e7/pax:,.0f}")
print(f"Q2FY27 fuel CASK/RASK: {2.44/5.76:.0%}")
print(f"FY25 Q4 ancillary share: {2152.5/22151.9:.1%}")
print("== Air India + IndiGo FY26 ==")
print(f"combined FY26 net loss: {22238 + 2393.6:,.1f} crore")
print("== Market ==")
print(f"CY25 vs CY24: {1669.46/1613.31-1:.2%}")
sep26, aug26 = 118.23, 121.26
print(f"Sep vs Aug 2026 MoM: {sep26/aug26-1:.2%}  -> so the reported -6.49% must be YoY")
jan_sep_26 = 1223.5
jan_sep_25 = jan_sep_26 / (1 - 0.0082)
jan_aug_25 = 1107.26
print(f"implied Jan-Sep 2025: {jan_sep_25:,.1f} lakh; implied Sep 2025: {jan_sep_25 - jan_aug_25:,.1f} lakh; Sep YoY: {sep26/(jan_sep_25-jan_aug_25)-1:.2%}")
print(f"implied Jan-Aug 2026: {jan_sep_26 - sep26:,.1f} lakh vs Jan-Aug 2025 {jan_aug_25}: {(jan_sep_26 - sep26)/jan_aug_25-1:.2%}")
shares = {"IndiGo": 65.4, "Air India Group": 26.8, "Akasa": 5.5, "SpiceJet": 1.2}
other = 100 - sum(shares.values())
hhi = sum(s*s for s in shares.values()) + other**2 * 0  # others are fragmented; ignoring them understates HHI slightly
print(f"HHI Sep-26 (top 4, SpiceJet at Aug share): {hhi:,.0f}; others combined {other:.1f}%")
print(f"IndiGo + AI group: {65.4+26.8:.1f}%")
print("== UDAN ==")
print(f"currently operational share: {348/679:.0%}; discontinued {679-348} routes")
udan_pax, years = 1.68e7, 9.25
print(f"UDAN pax per year ~ {udan_pax/years/1e5:,.1f} lakh = {udan_pax/years/1.66946e8:.1%} of CY25 domestic traffic")
print(f"UDAN flights: avg pax per flight {1.68e7/3.58e5:.0f}")
print(f"CAG: never commenced {403/774:.0%}")
print("== Benchmarks ==")
print(f"Ryanair ancillary share of revenue FY26: {4.99/15.54:.1%}")
print("== Illustrative ancillary math for Fly91 (assumption-driven) ==")
for wk in (354,):
    pax_yr = wk*52*seats*0.75
    for per in (100, 300, 900):
        print(f"{wk}/wk, LF75%: {pax_yr:,.0f} pax/yr x Rs{per} = Rs {pax_yr*per/1e7:,.1f} crore/yr")
print("== Goa ==")
print(f"Goa tourists 2025 vs 2024: {10802410/10409196-1:.1%}; vs 2023: {10802410/8628162-1:.1%}")
print(f"Mopa FY26 growth: {5376516/4643852-1:.1%}")
