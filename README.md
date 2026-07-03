# JustifyMyPrinter

Static multi-page site for the 3D printer project. The published root is the repository `main` branch and the Pages workflow builds a clean `public/` folder from the HTML/CSS/JS files in this repo.

## GitHub Pages deployment

1. Push this repository to GitHub.
2. In the repository settings, open **Pages** and set the source to **GitHub Actions**.
3. Push to `main` or run the **Deploy static site to GitHub Pages** workflow manually.

## Local preview

Open `index.html` directly in a browser, or use any static file server if you want a local HTTP preview.

## Build

Run `npm run build` to create the static site in `public/`. The same command is used by the GitHub Pages workflow.
