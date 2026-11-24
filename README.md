# Grey Goose

A minimal two-deck DJ mixer that runs in Chrome. No install, no dependencies.

## Run

```bash
cd greyGoose
python3 -m http.server 8000
```

Open http://localhost:8000 in Chrome. Use Chrome, not Safari, for MIDI (Safari has no Web MIDI).

## What it does

- **Library:** drop audio files (mp3, wav, m4a, aiff, flac, ogg) or choose them. Send a track to deck A or B.
- **Decks:** play/pause, cue, tempo (±8%, pitch preserved), 3-band EQ (±12 dB), filter sweep (left = low-pass, right = high-pass), echo send, reverb send, volume.
- **Mixer:** equal-power crossfader and master volume.
- **MIDI:** Connect MIDI, then turn on **MIDI learn**, click a control on screen, and move or press the matching control on your controller. Bindings are saved in the browser.

## Not yet

- SoundCloud. Streaming Go+ tracks needs SoundCloud API access, and the official terms restrict third-party streaming, so this build uses local files only.
- Jog wheels, beat sync, and loops.
- A packaged Mac app. Wrap it in Electron later if you want a .app.
