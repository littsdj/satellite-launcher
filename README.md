# Satellite Launcher

A short, story-driven game and article about hardware left behind in Earth orbit. You launch satellites into ever more crowded skies, then read why that matters: the Kessler syndrome, the chain reaction of crashes that scientists are working to prevent. Made for space fans aged about 9 to 14, with facts checked against NASA and ESA sources. Plain HTML, CSS and JavaScript (ES modules): no build step, no dependencies.

## How to play

- Pull back from the rocket to aim, then let go to launch.
- Press Space (or tap) to fire your burn and settle into orbit.
- Avoid other satellites. Three scripted levels lead into the article, then an endless game at the bottom asks: how many can you launch?

## Run locally

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. Add `?stub` (http://localhost:8000/?stub) to run with the demo stand-in engine instead of the real one. In stub mode, press O, C, L or X to force the next outcome to orbit, crash, lost or collision.

## Project structure

```
index.html          page: game, article, endless game, sources
css/styles.css      all styles
js/main.js          wiring: engine loading, two games, pausing
js/story/           story flow (levels, flow, endless, article, hud, storage, stub engine)
js/game/            the canvas game engine (owned separately)
dev.html            engine test page (owned separately)
```

## Deploy on GitHub Pages

Settings → Pages → Source: Deploy from a branch → Branch: `main`, folder: `/ (root)` → Save. All paths are relative, and `.nojekyll` is included.

## Sources

Facts checked November 2026. The game is a simplified model: orbits are not to scale.

- [ESA Space Environment Report 2025](https://www.esa.int/Space_Safety/ESA_Space_Environment_Report_2025)
- [ESA, Mitigating space debris generation](https://www.esa.int/Space_Safety/Space_Debris/Mitigating_space_debris_generation)
- [ESA, ClearSpace-1](https://www.esa.int/Space_Safety/Clearspace-1)
- [NASA Orbital Debris Program Office FAQ](https://orbitaldebris.jsc.nasa.gov/faq/)
- [NASA, Vanguard Satellite, 1958](https://www.nasa.gov/content/vanguard-satellite-1958)
- [US Naval Research Laboratory, Vanguard 65-year milestone](https://www.nrl.navy.mil/Media/News/Article/3332003/nrl-achieves-65-year-milestone-in-space-satellite-exploration/)
- [NASA ODPO, History of On-Orbit Satellite Fragmentations (Iridium 33/Cosmos 2251)](https://orbitaldebris.jsc.nasa.gov/library/HOOSF_16e.pdf)
- [NASA NTRS, Liou (2013), fragment counts for Iridium 33 and Cosmos 2251](https://ntrs.nasa.gov/api/citations/20150003820/downloads/20150003820.pdf)
- [NASA ODPO Orbital Debris Quarterly News 14(3)](https://www.orbitaldebris.jsc.nasa.gov/Quarterly-News/pdfs/ODQNv14i3.pdf)
- [NASA ODPO Orbital Debris Quarterly News 12(1) (Fengyun-1C)](https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv12i1.pdf)
- [FCC, 5-year rule for deorbiting satellites](https://www.fcc.gov/document/fcc-adopts-new-5-year-rule-deorbiting-satellites-0)
- Kessler, D. J. and Cour-Palais, B. G. (1978), "Collision frequency of artificial satellites: The creation of a debris belt", Journal of Geophysical Research 83(A6)
