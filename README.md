# Pips Helper

A small web app that reads a screenshot of the New York Times' daily [Pips](https://www.nytimes.com/games/pips) puzzle and walks you through the next logical step, one hint at a time.

**Live site:** https://carlified.github.io/pips-helper/

This is a personal project I made for my girlfriend. It isn't a product, it isn't for sale, and it isn't maintained. It's shared publicly only because that's the easiest way to get it onto a phone.

## What it does

1. Take a screenshot of today's Pips puzzle and load it into the helper. It can be a fresh puzzle or one you've already started.
2. The helper reads the board's shape, the coloured regions and their conditions, the dominoes in the tray, and any dominoes you've already placed.
3. Tap **Hint** for a nudge, again to see which cells are involved, and once more for the full explanation. **Apply & next** moves on. **Skip to next move** jumps straight to the next domino you can place.

The game has no pencil marks, so the helper keeps its own notes: the values each cell could still have, and which neighbouring cells are, or can't be, one domino. Hints use 17 human-style rules, easiest first. Each hint names the cells (lettered A, B, …), regions and dominoes involved in matching colours, and links to a short explanation of its rule.

## Installing on an iPhone

Open the live site in Safari, tap **Share → Add to Home Screen**, then open it once from the new icon while you're online. After that it works offline.

## Privacy

All processing happens on your device. Screenshots are never uploaded, and the app has no analytics, accounts or tracking. The site is hosted on GitHub Pages, so GitHub sees the usual request information (such as your IP address) when the page is loaded. See [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Disclaimers

- **Not affiliated with The New York Times.** This project has no connection to The New York Times Company or NYT Games, and is not endorsed or sponsored by them. "Pips" is used only to describe which puzzle's screenshots this tool can read. All trademarks belong to their respective owners. No puzzles or puzzle data are included or downloaded; the tool only reads screenshots you take yourself.
- **Made with AI.** Most of the code and text in this project was written with the help of Claude, an AI assistant made by Anthropic. I reviewed and tested it, but it may still contain mistakes.
- **Hints can be wrong.** Screenshot reading is tuned to how Pips looks today and may misread unusual devices or future app updates. Use **Compare screenshot** and **Fix a condition or domino** to check and correct what it read.
- **Some puzzles have more than one answer.** The helper only states what must be true in every solution, and says so when a step is a free choice.
- **Not maintained.** It may stop working if Pips changes how it looks. Issues and pull requests may not get a response.
- **Not for profit.** It's free, has no ads, and never will.
- **No warranty.** It's provided as is. See the license below.

## How it works (briefly)

- `vision.js` finds the board on the screen, then the cell grid by lining up the edges between cells. It works out regions from the dashed outlines and filled-in gaps between cells, and finds condition badges on cell corners. It reads their labels by matching each character against built-in shapes, counts the pips on the tray and placed dominoes, and takes all colours from the screenshot itself, so light and dark mode both work.
- `solver.js` holds the hint rules (see `rules.html`) and an independent brute-force search, used to check the puzzle was read correctly and to test that every rule only states things that hold in every solution.
- `app.js` and `index.html` are the interface. `sw.js` and `manifest.webmanifest` make it installable and usable offline.

There are no dependencies and no build step. It's plain HTML, CSS and JavaScript.

## License

[MIT](LICENSE) © 2026 Carl van Rooyen
