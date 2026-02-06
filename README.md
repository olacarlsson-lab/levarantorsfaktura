# VGR Leverantörsfakturor

Sökverktyg för Västra Götalandsregionens leverantörsfakturor. Appen söker direkt mot VGR:s öppna data via [Entryscape Rowstore API](https://vgregion.entryscape.net/) — ingen backend behövs.

## Funktioner

- **Filterbaserad sökning** — förvaltning, kontotext, leverantör, konto nr, leverantörs-ID och datumintervall
- **Kontokatalog** — utforska alla kontotyper med antal fakturor per konto
- **Leverantörskatalog** — utforska alla leverantörer med antal fakturor
- **Autocomplete** — förslag medan du skriver i textfälten
- **Snabbval för period** — vecka, månad, kvartal, år med navigeringsknappar
- **Sortering** — klicka på kolumnrubriker för att sortera
- **Expanderbara rader** — klicka på en rad för fullständig fakturainfo
- **Interaktiva resultat** — klicka på leverantör för att filtrera, +-knappar för förvaltning/kontotext
- **CSV-export** — exportera sökresultat till semikolonseparerad CSV
- **Mörkt läge** — följer systemets inställning automatiskt
- **Responsiv design** — fungerar på mobil och desktop

## Kom igång

Appen är en statisk webbsida utan beroenden. Öppna `index.html` i en webbläsare, eller servera med valfri HTTP-server:

```bash
# Python
python3 -m http.server 8000

# Node.js (npx)
npx serve .
```

Besök sedan `http://localhost:8000`.

## Filstruktur

```
index.html   — HTML-struktur
style.css    — All CSS (ljust/mörkt tema, responsivt)
app.js       — Applikationslogik (API-anrop, filter, kataloger, autocomplete)
```

## Datakälla

Data hämtas i realtid från VGR:s öppna dataset med 878 000+ rader:

**API:** `https://vgregion.entryscape.net/rowstore/dataset/fc4d86d5-5ad4-43af-8193-319cd4448fc0`

API:et stöder prefix-sökning (`fält=term*`), paginering (`_limit`/`_offset`) och returnerar JSON.

## Licens

MIT
