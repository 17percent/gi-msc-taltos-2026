
A modern prompt-engineering és az AI tudatosság növelése érdekében az alábbi új funkciók kerülnek bevezetésre a rendszerbe. Ezek a fejlesztések mind a laikus, mind a professzionális felhasználók számára drasztikusan javítják a hatékonyságot és a felhasználói élményt (QoL - Quality of Life).

---

### 📋 1. Általános Információs Szekció (Metaadatok Kezelése)
> *Eredeti: General info section on all forms for metadata (optional and generated)*

Minden prompt-generáló űrlap tetején helyet kap egy dedikált **Metaadat Szekció**.
* **Működés:** Itt adhatók meg a prompt globális paraméterei (pl. aktuális dátum, időzóna, folyamat státusza, célközönség). Ezek az adatok manuálisan is kitölthetők, de a rendszer **automatikusan is képes generálni** őket (pl. az aktuális rendszeridő alapján).
* **Előny:** Segít a kontextusépítésben és csökkenti az AI hallucinációját anélkül, hogy a felhasználónak minden alkalommal kézzel kellene begépelnie ezeket.

### ⚙️ 2. Rendszerutasítás (System Instruction) Testreszabó
> *Eredeti: System Instruction Customizer - editable form for unique model instructions*

Egy különálló, szerkeszthető felület a modell "alapszemélyiségének" beállítására.
* **Működés:** A felhasználók létrehozhatnak és menthetnek egyedi rendszerutasításokat (System Prompts). Például beállíthatják, hogy az AI *"mindig viselkedjen Senior Python Fejlesztőként"*. A legjobb felhasználási gyakorlatok és javaslatok itt is megtekinthetők a rendszerben használt többi formhoz hasonlóan.
* **Előny:** Szétválasztja a globális viselkedési szabályokat az aktuális, napi szintű feladatoktól. Ezzel optimalizálja az API költségeket (Prompt Caching) és tisztább prompt-architektúrát eredményez.

### 🧩 4. Stratégia-specifikus Dinamikus Űrlapok
> *Eredeti: Enhanced forms for all methods (unique in all cases)*

Búcsú az "egy kaptafára" készült szövegdobozoktól! Minden promptolási stratégia a **saját logikájára szabott** beviteli mezőket kapja.
* **Működés:** A *Few-Shot* (Példákon alapuló) stratégiánál az űrlap automatikusan "Bemenet-Kimenet" párokat kér be; a *Chain-of-Thought* módszernél pedig külön mező lesz a "Gondolkodási lépések" definíciójának.
* **Előny:** A laikus felhasználót "kézen fogva" vezeti végig a bonyolultabb technikákon, míg a profiknak strukturált, átlátható munkaterületet ad.

### 💡 5. Intelligens Prompt Ajánló Rendszer
> *Eredeti: Prompt Recommendation System - answering follow-up questions result in prompt technique recommendations*

Egy interaktív "varázsló" (Wizard), amely segít a megfelelő stratégia kiválasztásában.
* **Működés:** A rendszer feltesz néhány egyszerű, célirányos kérdést (pl. *"Kreatív szöveget írsz, vagy adatot vonsz ki?"*, *"Mennyire fontos a pontosság?"*). A válaszok alapján **javaslatot tesz** az optimális promptolási technikára (pl. ajánlja a *Tree of Thoughts* vagy a *Sűrűségi Lánc* módszert részletes indoklással).
* **Előny:** AI tudatosság-növelő (edukációs) funkció, amely megtanítja a felhasználóknak, hogy melyik feladathoz melyik eszközt érdemes használni.

### 👀 6. Élő Előnézeti Mód (Real-time Preview)
> *Eredeti: Preview mode during form editing*

Az űrlap kitöltése közben valós időben generálódik a végleges prompt kódja.
* **Működés:** Egy különálló, erre a célra kifejlesztett felületen a felhasználó azonnal látja, ahogyan az űrlapon megadott adatok beépülnek a végleges prompt szövegébe. (*Preview*)
* **Előny:** Azonnali vizuális visszajelzést ad, minimalizálja az elgépeléseket, és a felhasználó azonnal látja, ha valamilyen fontos információ hiányzik a promptból.

### 🎨 7. Anatómiai Szintaxis-kiemelés (Prompt Röntgen)
> *Eredeti: Highlight mechanism applied on syntax in preview mode (unique in all cases)*

Vizuális színkódolás alkalmazása az előnézeti módban generált szövegre.
* **Működés:** A prompt különböző építőkövei (pl. *Metaadatok*, *Kontextus*, *Feladat*, *Példák*, *Szabályok*) **eltérő színű kiemelést** kapnak a generált szövegben.
* **Előny:** A felhasználó azonnal átlátja a prompt "anatómiáját". Egy vizuális ellenőrző eszközként funkcionál, amellyel egy szempillantás alatt leellenőrizhető, mennyire kiegyensúlyozott a prompt szerkezete.

### 🎛️ 8. Generálási Paraméterek Gyorsbeállítója
> *Eredeti: Customize generation parameters (e.g.: setting output constraints, guards and format) with checkboxes and sliders (applies per prompt)*

A kimeneti forma és a korlátok szabályozása vizuális UI elemekkel, kódolás (szövegírás) nélkül.
* **Működés:** A felület egy dedikált pontján, egy beállító panelen, **jelölőnégyzetek (checkboxok)** és **csúszkák (sliderek)** segítségével határozható meg a kimenet. (Pl.: *Kimeneti formátum: [x] JSON | numerikus csúszka: 0 -> 1000 | [x] Szakzsargon tiltása*).
* **Előny:** Drasztikusan felgyorsítja a promptírást (QoL), és biztosítja, hogy a biztonsági szabályok (guards) és korlátozások (constraints) szabványos formában, hibátlanul kerüljenek be a promptba.