# SynthHub - Behringer synth control over WebUSB / WebMIDI

[![Live app](https://img.shields.io/badge/live-synth--hub.elevatech.xyz-00ff9c)](https://synth-hub.elevatech.xyz/)
[![Donate](https://img.shields.io/badge/donate-buy%20me%20a%20coffee-ffb000)](https://buymeacoffee.com/utajum)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](#license)

[![Star History Chart](https://api.star-history.com/svg?repos=utajum/SynthHUB&type=Date)](https://star-history.com/#utajum/SynthHUB&Date)

**Live at [synth-hub.elevatech.xyz](https://synth-hub.elevatech.xyz/)** - runs
entirely in your browser.

The Web App that manages every
Behringer synthesizer over USB - an alternative to Behringer's SynthTribe
desktop editor. Edit device settings, run the step sequencer, record MIDI, and
check firmware status for **71 Behringer models** directly in your browser, with
no install and no drivers.

**Supported synths include:** Behringer 2600 (Blue Marvin / Gray Meanie), TD-3,
TD-3-MO, RD-8, RD-9, RD-6, Model D, Poly D, Pro-1, Pro-800, MS-1, MS-5, Model 15,
UB-Xa, Odyssey, Crave, K-2, Kobol Expander, MonoPoly, Wasp Deluxe, Edge, Spice,
Proton, JT-4000, JT-2, CAT, Solina, Vocoder VC340 and many more.

- Device discovery over **WebUSB** (Behringer vendor id `0x1397`).
- Device control over **WebMIDI** SysEx (USB-MIDI) - settings, sequencer.
- **71 device models**, **130 USB product IDs**.
- Per-device settings UI (dropdowns / toggles / spin boxes / radios / sliders),
  a full sequencer editor (ratchets, per-step velocity / gate / probability,
  directions, live MIDI-in recording), CV calibration references and poly-chain.
- Installable, offline-capable PWA. Everything runs locally in the browser; no
  server, no telemetry.

> Not affiliated with, endorsed by, or connected to Behringer / Music Tribe.
> For interoperability and educational purposes. Firmware update is out of scope of this app.

## Quick start

```bash
cd app
npm install
npm run dev        # http://localhost:4321
```

Open in a Chromium-based browser (Chrome / Edge / Brave / Opera) over
localhost or HTTPS - WebUSB and WebMIDI require a secure context. Click
`CONNECT USB`, pick your Behringer synth, and its controls appear.

## Repository layout

```
behringer/
|-- app/                  # the Astro PWA (see app/src)
|   `-- src/
|       |-- data/         # generated device tables (committed)
|       |-- lib/          # shared helpers: webmidi, webusb, sysex, discovery, store, sequencer
|       |-- devices/      # per-device logic dirs + _shared driver + registry
|       |-- components/   # SolidJS UI islands
|       `-- pages/        # console, catalog, about
```

## Support the project

If SynthHub saves you a desktop install (or a stuck note), you can
[buy me a coffee](https://buymeacoffee.com/utajum). It keeps the device
coverage growing.

## License

MIT for our own code. Device parameter tables are factual data recovered for
interoperability. All trademarks belong to their respective owners.
