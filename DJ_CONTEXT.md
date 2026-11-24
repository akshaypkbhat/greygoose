# DJ Context for Grey Goose

Context for building a small two-deck Mac DJ app. Sources are official manuals where read; gaps are marked.

## Key concepts

- **BPM (tempo):** Beats per minute. Software shows it per track; it can be wrong, so it must be checked.
- **Beat and bar:** The beat is the pulse you tap your foot to. A bar (measure) is a group of beats, usually 4 in dance music.
- **Beatgrid:** A series of markers placed on a track showing where each beat falls. It drives sync, quantizing, looping and snapping of cues. Mixxx defines it this way; Traktor says analysis usually creates one grid marker at constant tempo, which is accurate for most tracks.
- **Phase:** A track's beat position relative to another track. Two tracks are in phase when their beats line up. Tempo matching alone does not guarantee phase.
- **Tempo sync vs beat sync:** Tempo sync matches BPM only. Beat sync matches BPM and aligns beats (phase). Mixxx's Sync button (left-click) matches BPM and phase; right-click matches only tempo. Traktor's Tempo Sync locks tempo and leaves phase adjustable; its Beat Sync locks tempo and phase to the beatgrid. djay offers "BPM Sync" and "BPM + Beat Sync".
- **Phase meter:** A meter showing how far the track is ahead of or behind the master. Centered means in phase. Traktor documents it; it is only meaningful when both beatgrids are correct.
- **Pitch bend / nudge:** Temporarily speeding up or slowing a track to correct phase or tempo by ear.
- **Quantize:** Snaps cue and loop points, and beat jumps, to the nearest beat on the beatgrid.
- **Key:** The musical key of a track (for example, C major). Key lock keeps key constant when tempo changes.
- **Cue point:** A saved position in a track. Intro/outro cues mark where mixing should start and end.
- **Hot cue:** A cue assigned to a button or pad for instant jumping. Mixxx supports up to 36 per track.
- **Loop:** A section that repeats between two points, usually on whole beats.
- **EQ and kill:** Low, mid and high frequency controls per deck. A kill switch fully removes a band while held or latched.
- **Filter / low cut:** Removes low (or high) frequencies to thin a track during a transition.
- **Crossfader:** Slider that sets how much each deck reaches the output. Its curve controls how quickly volume changes near the edges.
- **Gain (trim):** Per-track input level adjustment before the channel fader. Used to balance tracks.
- **Master meter:** Shows the summed output level. Mixxx's guidance: keep levels in the green, transients may reach yellow, never red (clipping).

## How a typical mix works

1. **Load and check the incoming track.** Confirm BPM, beatgrid and key on the incoming deck. Fix a wrong grid before mixing (Mixxx: cue to a real beat and set the grid there).
2. **Set up levels.** Adjust gain so the incoming deck's meter sits near the top of the green. Keep the master out in the green.
3. **Cue the incoming track.** Start it in the headphones (cue) channel, or on its intro cue, and listen against the playing track.
4. **Match tempo.** Sync (Mixxx, djay, Traktor, VirtualDJ all offer it), or match by ear with the pitch slider.
5. **Align beats (phase).** With sync on Quantize, or nudge by ear: right-click and drag on the waveform, or use pitch bend, until the kicks line up. Listen for "double bass kick" drift and correct it.
6. **Bring in the incoming track.** Raise its channel fader and crossfader. Often start on an intro or outro cue.
7. **Swap the bass.** Cut the incoming deck's bass EQ and cut the outgoing deck's bass, then restore the incoming bass on a phrase boundary (for example, after two phrases). Two bass lines at full volume muddy the mix. Gradual cuts are also common.
8. **Finish the outgoing track.** Cut its fader and EQ, then leave the incoming track playing.
9. **Use cues and loops as needed.** Hot cues jump to drops or breaks; loops extend a section for tension.

## What software shows and why

- **Waveform with beat and bar markers:** Shows where beats fall so you can align kicks and phrases by sight.
- **BPM and key:** Shows which tracks will match. Traktor highlights tracks with matching keys when the master is key-locked; Mixxx detects key and can display notation.
- **Phase meter:** Shows the beat offset to the master, so you know which direction to nudge.
- **Sync state:** Lit or coloured buttons show that a deck is synced (Traktor, djay, Serato).
- **Level meters:** Per-deck and master meters show gain staging and clipping.
- **Cue and loop markers:** Show saved positions and the length of intro and outro sections.

## What the app needs for v1

Supported by the research:
- Track analysis that produces BPM, a beatgrid (constant tempo first) and key.
- Waveform showing beat and bar markers, with a phase meter against the other deck.
- Two decks, each with: play, tempo (pitch) slider, sync (tempo plus beat), and nudge/pitch bend.
- Quantize option that snaps cues and loops to the beatgrid.
- Hot cues and a single loop (beat-length loop).
- Per-deck gain, three-band EQ with kill switches, and a low-cut or filter.
- Crossfader with at least one curve choice, and per-deck assignment (left/right).
- Master output with level meters that show clipping.
- Manual beatgrid nudge (set the first beat), since automatic detection can be off.

Not confirmed by the research, so do not treat as requirements without further sourcing:
- Track selection rules, such as "BPM within a few points" and Camelot-style key compatibility. Searches did not find official sources.
- Exact crossfader curve shapes and default values.
- Exact meter ballistics and dBFS targets.

## Sources

- [Mixxx 2.5 manual: DJing with Mixxx](https://manual.mixxx.org/2.5/en/chapters/djing_with_mixxx) (beatmatching, sync lock, intro/outro cues, key lock notes)
- [Mixxx 2.5 manual: User Interface](https://manual.mixxx.org/2.5/en/chapters/user_interface) (EQ kill, gain, crossfader, level meters)
- [Mixxx 2.5 manual: Glossary](https://manual.mixxx.org/2.5/en/glossary) (beatgrid, phase, key, hotcue definitions)
- [Mixxx User Manual index](https://manual.mixxx.org/)
- [Traktor Play user guide: Beat matching and sync](https://docs.native-instruments.com/online-guides/traktor-play-user-guide/en/beat-matching-and-sync) (Tempo vs Beat Sync, phase meter, beatgrid notes)
- [djay Pro for Mac: BPM and beat sync](https://help.algoriddim.com/user-manual/djay-pro-mac/dj-tools/beatgrids-bpm-sync/sync) (BPM Sync vs BPM + Beat Sync)
- [djay Pro for Mac: Beatgrids and BPM overview](https://help.algoriddim.com/user-manual/djay-pro-mac/dj-tools/beatgrids-bpm-sync) (section overview only; detailed beatgrid pages not read)

## Gaps and unconfirmed items

- Serato, rekordbox and VirtualDJ were only seen in search snippets, not in fetched official pages. Their claims (Serato Beat Sync and cue loops, rekordbox quantize and phase meter, VirtualDJ crossfader curve setting) are not used as sources here.
- Traktor Pro 3 manual and Mixxx key-matching guidance on track selection were not found in full.
- No official source confirmed BPM-range or key-compatibility rules for track selection.
