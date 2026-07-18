# Safari on iOS — sideloading (not the App Store)

Installs Bulgarian Accenter on **your own iPhone**, over a cable, via Xcode. No App Store
submission, no review, no paid Apple Developer account — a free Apple ID is enough. The trade-off:
the install expires every **7 days** and needs a one-tap refresh from Xcode.

(A real App Store release is a separate, much longer process — developer enrollment, listing
assets, review — and isn't covered here.)

## Prerequisites

- A Mac with **Xcode** installed (free, Mac App Store).
- An **Apple ID** added in Xcode → Settings → Accounts. No paid enrollment needed.
- An iPhone and a cable that carries data, not a charge-only one.

## 1. Build the extension

```sh
npm ci
npm run dict:fetch   # generated, not in the repo — this pulls it (3 MB, hash-verified)
npm run build         # -> dist/chrome, dist/firefox, dist/safari
```

## 2. Open the Xcode project

`safari/Bulgarian Accenter/Bulgarian Accenter.xcodeproj` is already in this repo and points at
`dist/safari` by path, so step 1 is all you need before every build — no need to re-scaffold.

(Re-scaffolding is only needed if `safari/` is gone, e.g. a fresh clone that never had it:
`xcrun safari-web-extension-converter dist/safari --project-location safari --app-name "Bulgarian Accenter" --bundle-identifier io.github.noomorph.bulgarian-accenter --swift --ios-only --no-open --no-prompt`.)

## 3. Sign and run

1. Open the project in Xcode.
2. Select **both** targets ("Bulgarian Accenter" and "Bulgarian Accenter Extension") → *Signing &
   Capabilities* → check *Automatically manage signing* → pick your personal team.
3. Plug in the iPhone, unlock it, tap **Trust** on the "Trust This Computer?" prompt.
4. Pick the iPhone in Xcode's device dropdown (top toolbar) and hit **▶**.

## 4. Enable Developer Mode on the phone

The setting doesn't exist until Xcode's first install attempt asks for it.

- Follow the alert if one shows up on the phone or in Xcode.
- Otherwise: **Settings → Privacy & Security** → scroll to the bottom → **Developer Mode** → on →
  phone restarts → confirm **Turn On**.
- Back in Xcode, hit **▶** again.

## 5. Trust the developer certificate

First launch is blocked by an "Untrusted Developer" alert.

**Settings → General → VPN & Device Management** → under *Developer App*, tap your Apple ID entry
→ **Trust "…"** → confirm. Then open the app icon once from the home screen.

## 6. Turn the extension on

**Settings → Apps → Safari → Extensions** → enable **Bulgarian Accenter** → grant it site access
(e.g. *Allow on Every Website*). Open Safari, visit a Bulgarian page — done.

## Renewing

A free Apple ID signs apps for **7 days**. When it lapses, the extension silently stops working —
reconnect the phone to Xcode and hit ▶ again. Nothing to reconfigure.

## Troubleshooting

- **"No profiles found" / "Your team has no devices"** — the phone isn't connected, unlocked, and
  trusted yet. Xcode only learns about a device once it's plugged in and picked as the run
  destination.
- **Developer Mode missing from Settings** — you haven't attempted a Run from Xcode yet; that's
  what makes the toggle appear at all.
- **"Untrusted Developer" won't go away** — you trusted the cert but haven't opened the app once
  from the home screen; the extension won't show up in Safari's list until you do.
