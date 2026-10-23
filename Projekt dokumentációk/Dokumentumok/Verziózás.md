---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 5
---

# Verziózás

## Cél

Látható legyen, ki mit és mikor változtatott, két változat összevethető legyen, és bármelyik korábbi állapot visszaállítható.

## Működés a prototípusban

A dokumentum Verziók fülén két revízió kijelölésével soronkénti diff jelenik meg. A visszaállítás új revíziót hoz létre, a történet nem íródik át. Rendezésváltó: legújabb vagy legrégebbi elöl (1. kör).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D1, D21 (diff-nézet az MVP-ben, alkalmazásszintű szövegdiff). Tárolás: [[Adattárolás/Revíziók tárolása|Revíziók tárolása]].

## Nyitott kérdések

- ~~Soronkénti vagy szó szintű diff?~~ **Döntve (D45):** soronkénti, a módosult sorokon belül szószintű kiemeléssel.
- ~~Mikor nő az `iteration`?~~ **Döntve (D45):** minden Jóváhagyott változáskor (v1, v2 …).
- **Visszaállítás (D45):** régi verzióra visszaállítás új változásként indul, két review-errel.

## Kapcsolódó egységek

[[Adattárolás/Revíziók tárolása|Revíziók tárolása]] · [[Dokumentumok/Státusz-workflow|Státusz-workflow]] · [[Nyomonkövetés/Eseménynapló|Eseménynapló]]
