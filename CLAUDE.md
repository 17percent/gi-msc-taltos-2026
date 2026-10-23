<!-- BEGIN agentic-fleet (managed by install.sh; do not edit inside) -->
@.claude/fleet/POLICY.lite.md
<!-- END agentic-fleet -->

# Projekt-dokumentáció (tulajdonosi döntés, 2026-10-23)

- A `Projekt dokumentációk/` mappa az Obsidian-vault: **ebből építkezünk**, és ez a mester. Az egységjegyzetek (`Dokumentumok/`, `Felhasználók/`, `Kollaboráció/` …) adják a funkcionális részleteket, a térkép a `Táltos – Áttekintés.md`; a tervdokumentumok az aktuális körben vannak (`Tervezés/Tervezés (hetedik kör)/`, döntési napló v10). A korábbi körök csak történeti anyag, nem szerkesztjük őket.
- Az `Arch/` az aktuális kör bájtra azonos tükre (stabil útvonal a README-nek és az agenteknek). **Soha nem az `Arch/`-ban szerkesztünk**: a vaultban módosítunk, utána `py -3 tools/sync_arch.py`; munka végén `py -3 tools/sync_arch.py --check` legyen zöld.
- Ha a munka során egy egységjegyzet változik vagy elavul, frissítjük, és a döntési naplót vele szinkronban tartjuk: új döntés = új D-pont + changelog-sor **helyben, a v10-en belül**; új kört (nyolcadik kör, v11) csak a tulajdonos kérésére nyitunk (ekkor a `tools/sync_arch.py` `CURRENT_ROUND` értéke is változik). Döntés-tartalmat (új/módosított D-pont, NY lezárása) a tulajdonos jóváhagyása nélkül nem írunk be; ütközésnél a napló nyer, és jelezzük az eltérést.
- A jegyzetek közti `[[…]]` wikilinkeket és az Áttekintés állapotjelöléseit (✅ 📘 💡 ❓ …) a módosításkor karbantartjuk.
