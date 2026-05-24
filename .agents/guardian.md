# Guardian Journal

Reusable Guardian decisions and PR-shipping notes for this repository.

| Date | Context | Decision | Outcome |
|------|---------|----------|---------|
| 2026-05-24 | Ref Incident Flight Recorder PR ship | Classify as S-size feature-flagged UI/docs change; security neutral; low risk because no Git writes, no external calls, and existing `?flight=1` / `VITE_REFSCOPE_FLIGHT_RECORDER=1` gate remains intact. | Proceed with single PR; no split required. |
