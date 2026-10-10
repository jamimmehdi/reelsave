# Reelsave

Mobile-first PWA to save public Instagram and Facebook reels. Static frontend (GitHub Pages) + a tiny Cloudflare Worker backend.

```
index.html  styles.css  app.js  config.js  sw.js  manifest.webmanifest  icons/   <- frontend (GitHub Pages)
worker/worker.js  worker/wrangler.toml                                          <- backend (Cloudflare)
```

## 1. Deploy the backend (Cloudflare Worker, free)

Instagram and Facebook block browser requests (CORS), so a small server-side helper fetches the video link.

**Dashboard way (no tools needed)**
1. Sign in at dash.cloudflare.com → Workers & Pages → Create → Worker.
2. Name it `reelsave`, deploy, then "Edit code".
3. Paste the contents of `worker/worker.js`, then Deploy.
4. Copy the URL, e.g. `https://reelsave.yourname.workers.dev`.

**CLI way**
```bash
cd worker
npx wrangler login
npx wrangler deploy
```

Check it works by opening `https://<your-worker>/api/health`. It should show `{"ok":true}`.

Optional: set `ALLOWED_ORIGIN` in `wrangler.toml` to `https://yourname.github.io` so only your app can use the worker.

## 2. Deploy the frontend (GitHub Pages)

1. Open `config.js` and set `window.REEL_API` to your worker URL (or skip this and enter it in the app's settings).
2. Create a GitHub repo and push all files in this folder (not the `worker` folder, though it's harmless).
3. Repo → Settings → Pages → Deploy from branch → `main` / root.
4. Your app is at `https://yourname.github.io/<repo>/`.

## 3. Install on iPhone

1. Open the Pages URL in **Safari**.
2. Share → **Add to Home Screen**.
3. Open it from the home screen. Tap the settings icon and add your worker URL if you didn't put it in `config.js`.

## 4. Share straight from Instagram / Facebook

iOS doesn't let web apps show up in the share sheet, so use a one-time Shortcut:

1. Open the **Shortcuts** app → **+** → name it **Reelsave**.
2. Tap the info (i) button → turn on **Show in Share Sheet** → Share Sheet Types: **URLs** and **Text**.
3. Add actions:
   - **URL Encode** (input: *Shortcut Input*)
   - **Text**: `https://yourname.github.io/<repo>/?url=` followed by the *URL Encoded Text* variable
   - **Open URLs** (input: the Text above)
4. Done. In Instagram or Facebook: reel → Share → **Reelsave**. The app opens, fetches the reel, and you tap Download, then Save to Photos.

(Android Chrome supports sharing directly to the installed PWA; the manifest already includes a share target.)

## Notes

- Public videos only.
- Instagram/Facebook change their pages from time to time; if fetching starts failing, `worker/worker.js` (`resolveInstagram` / `resolveFacebook`) is the only part that needs updating, and you can redeploy it without touching the app.
- Saving to Photos uses the iOS share sheet, so after the download finishes tap **Save to Photos**, then **Save Video**.
