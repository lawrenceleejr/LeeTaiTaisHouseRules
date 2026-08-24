# Lee TaiTai's House Rules

*One game. Two eyes. Three suits. Four legs.*

A polished, playful explainer site for Hong Kong–style mahjong as played at
the Lee family table — tiles, turns, winning, the point system, and the
house rules (transcribed from the official laminated rule card), with a
glossary and a printable cheat sheet.

**Live site:** https://lawrenceleejr.github.io/LeeTaiTaisHouseRules/

Made possible by the *Adopt A Jook Sing Project*.

## Stack

- [Hugo](https://gohugo.io) (extended, pinned in `Dockerfile` /
  `.github/workflows/pages.yml`) with a fully custom theme in `layouts/`
- Mahjong tiles rendered as inline SVG by `layouts/partials/tile.html` —
  no images, theme-aware, accessible labels
- Self-hosted fonts in `static/fonts/`: Fraunces + Inter, plus
  LXGW WenKai TC and Noto Serif TC subset to exactly the characters the
  site uses (see `assets/css/fonts.css`)
- Light/dark theme, responsive, reduced-motion aware

## Writing content

Pages are Markdown in `content/`. Useful shortcodes:

```
{{< tile b3 >}}                            one inline tile
{{< hand tiles="b1 b2 b3 | d5 d5*" caption="..." >}}   a row ( | = gap, * = highlight, _ = face-down)
{{< zh "食糊" "sik wu" "to win" >}}         hanzi + romanization + tooltip gloss
{{< taitai >}} wisdom {{< /taitai >}}   auntie callout
{{< houserule title="..." >}} law {{< /houserule >}}
```

Tile codes: `d1–d9` dots, `b1–b9` bamboo, `c1–c9` characters,
`we ws ww wn` winds, `dr dg dw` dragons, `f1–f4` seasons, `p1–p4` plants,
`back`. Glossary entries live in `data/glossary.yaml`.

## Build & preview

```sh
./run.sh build            # in Docker; outputs to ./public
./run.sh serve            # live-reload dev server on :1313
FORCE_HOST=1 ./run.sh build   # on the host if hugo is installed
```

## Deploy

GitHub Actions (`.github/workflows/pages.yml`) builds every push and
deploys to GitHub Pages from `main`. One-time repo setting (a workflow
token can't do this itself): **Settings → Pages → Source: GitHub Actions**,
then re-run the latest `pages` workflow on `main`.
