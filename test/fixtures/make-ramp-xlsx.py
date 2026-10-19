# Regenerates test/fixtures/ramp.xlsx (fixture only; names and dates are made up for the test).
import datetime as dt, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Contributors"
ws.append(["Worker ID", "Signup Date", "Vetted On", "Onboarded At", "First Task Accepted", "Ramped At", "Team"])
d = lambda day: dt.datetime(2026, 10, day)
ws.append(["W-1", d(1), d(2), d(4), d(5), d(8), "Pod A"])
ws.append(["W-2", d(1), d(3), None, None, None, "Pod B"])
ws.append(["W-3 \"quoted\", comma", "10/02/2026", "10/03/2026", d(6), None, None, "Pod A"])  # text dates
ws.append(["W-4", d(3), d(5), d(4), d(7), d(10), "Pod B"])  # trained before screened -> order violation
ws.append(["W-5", None, None, None, None, None, "Pod C"])  # no recruit date -> skipped
wb.save("test/fixtures/ramp.xlsx")
