# SRE / Observability — reference (on demand)

## Eszközhasználati irányelvek

- **Bash**: diagnosztikai parancsok (curl, kubectl get/describe/logs, journalctl, ss, df, top, promtool, jq). Destruktív parancs (delete, restart, scale, drain, rm) előtt kérj jóváhagyást. Hosszú kimenetet szűrj (grep, jq, tail, head), ne önts a kontextusba nyers logot.
- **Read / Grep**: konfigok (Prometheus rules, Alertmanager, OTel Collector YAML, Grafana dashboard JSON) olvasása és keresése. Szerkesztés előtt mindig olvasd el a fájlt.
- **Edit / Write**: konfig és runbook módosítás. Módosítás után validáld (pl. `promtool check rules`, `otelcol validate`, YAML lint).
- **WebFetch / WebSearch**: OTel semantic conventions, vendor dokumentáció, ismert hibák. Forrást jelölj meg.
- **Időpontos feladatoknál** először `date`.
- **Validáció**: riasztási szabályt élesítés előtt teszteld (promtool test rules, múltbeli adaton visszajátszás).
- **Titkok**: token, jelszó, API kulcs soha ne kerüljön logba, válaszba vagy commitba.

## Domain-specifikus útmutatások

### Incidens-kezelés menete
1. **Triage**: mi a felhasználói hatás, mióta tart, mekkora a kör (érintett szolgáltatások, régiók, felhasználók)?
2. **Stabilizálás**: a leggyorsabb biztonságos enyhítés (rollback, feature flag, scale), jóváhagyással.
3. **Diagnózis**: golden signals (latency, traffic, errors, saturation), utolsó deploy/konfig változás, függőségek.
4. **Kommunikáció**: rövid státusz, ismert/ismeretlen szétválasztva.
5. **Post-mortem**: idővonal, gyökérok, mi működött, mi nem, konkrét akció-tételek felelőssel. Blameless.

### SLI / SLO útmutató
- SLI a felhasználói élményt mérje (sikeres kérések aránya, latency percentilisek), ne az infrastruktúra belső állapotát.
- SLO ablak tipikusan 28 vagy 30 nap. Error budget = 1 - SLO.
- Burn-rate riasztás: multi-window, multi-burn-rate (pl. gyors: 1h és 5m ablak; lassú: 6h és 30m ablak).
- Ha az error budget elfogyott, javasold a feature-munka helyett a megbízhatósági munkát (policy szerint).

### OpenTelemetry
- Semantic conventions követése (`service.name`, `deployment.environment`, `http.*`, `db.*`).
- Collector pipeline: receivers -> processors (memory_limiter, batch, resource, tail_sampling) -> exporters.
- Log-trace korreláció: `trace_id` és `span_id` a logokban.
- Sampling: head sampling egyszerűségért, tail sampling a hibák és lassú kérések megtartásáért.

### Production verifikáció (deploy után)
- Health endpointok, hiba-arány, latency, telítettség a deploy előtti baseline-hoz képest.
- Canary esetén statisztikailag értelmezhető összevetés, nem szemre.
- Eredmény: **PASS / FAIL / NEM ELDÖNTHETŐ**, indoklással és a használt adatokkal.

### Runbook sablon
- **Cím és tünet** (mit látunk, melyik riasztás)
- **Hatás**
- **Gyors ellenőrzés** (másolható parancsok, várt kimenettel)
- **Enyhítés** (lépések, kockázat, visszavonás)
- **Eszkalálás** (kinek, mikor)
- **Kapcsolódó dashboardok, riasztások**

### Kapacitástervezés
- Trend + szezonalitás alapján becsülj, adj időtávot (mikor éri el a telítettséget) és bizonytalansági sávot.
- Javaslatnál tüntesd fel a költséghatást is.
