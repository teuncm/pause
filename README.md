# Pause

A mobile-first, accessible meditation SPA built with Vue, Vite, and Lucide icons.

## Run locally

```sh
npm install
npm run dev
```

Choose a timer (1–180 minutes) or Timeless mode with no time limit. Sessions support pause,
resume, and end.

Breathing assistance and Bell sounds each have a separate disclosure button for
their settings. Turning a feature off collapses its settings and disables expansion.
Enabling a feature opens its settings; collapsing them leaves
the feature enabled and preserves its values. Breathing phase controls use two
rows: In / In-hold, then Out / Out-hold.

Breathing assistance expands the session circle during In, glows at full size
during In-hold, contracts during Out, and glows at its smallest size during
Out-hold. Set each phase in whole seconds (1–60 for in/out, 0–60 for holds).
The default cycle is 4 / 2 / 6 / 2 seconds; zero skips a hold. Hide time defaults
to on: active breathing sessions show the circle and phase name, without session
time, phase seconds, or the timer progress arc. The timer and bells still run,
and the duration summary appears when the session ends. Switch Hide time off to
show the clock; without breathing assistance, time is always shown.
Motion's mini animation library drives linear expansion and
contraction, follows active session time, and freezes on pause. There is no custom
animation-frame loop.
Reduced-motion mode uses phase text and a stationary hold glow. Optional audio
guidance plays quiet filtered white noise: a fixed 500 Hz high-pass reduces rumble,
while the low-pass cutoff rises gently from 800 to 1200 Hz during In and falls
back during Out, with gentle attacks and releases. Both holds are silent.
Tone.js Transport schedules the sweeps; session time and bells share its audio
clock. Pause silences guidance, and Resume continues at the current phase's
cutoff with a fresh soft attack. Audio guidance defaults to off.

Enable Bell sounds and set Repeat to Never (the default) or every 1, 2, 5, 10, 15,
or 30 minutes. Never disables interval bells while preserving the separate start
and end bell settings. Under Bell sounds, At session start and At session end
both default to on. These ring once for a new session and once on natural timer
completion or End session. Resume does not repeat the start bell. Interval bells
count active session time and pause with the session. A timer boundary produces
only the selected end bell, never an additional interval bell; switching the end
bell off leaves that boundary silent. Returning home cancels all sound. Use Test
bell to preview the sound. No audio files are downloaded.
The Sound dropdown contains ten presets. Soft bowl, Tibetan bowl, Deep bowl,
Bronze bowl, and Warm bowl use low fundamentals of 65–110 Hz. Temple gong,
Bronze bell, Singing glass, Temple bell, and Distant bell offer slightly higher
fundamentals of 147–294 Hz. All are single sustained strikes with soft attacks,
fixed partial frequencies, and long decays, without melodies, repeated notes,
or notification-style note sequences. Inharmonic upper partials retain their
metallic character, and stereo chorus adds warmth around the centered resonance.
Test bell previews the selection; the same sound is used for session start,
intervals, and session end. All sounds are synthesized locally.

Bells are scheduled ahead on the browser's audio timeline to tolerate delayed UI
updates. Browsers or devices may suspend audio when backgrounded or locked; an
audio interruption pauses the session so it can be resumed explicitly.

Appearance follows your device by default, including changes while the app is open.
Use the header's icon button to switch between light and dark; your selection is
remembered on this browser.

## Configuration

Edit `src/constants.js` to tune session defaults, timer limits and presets,
breathing phase defaults and animation, bell repeat options, and audio settings.
`GUIDANCE_AUDIO` contains filter frequencies, volume, and attack/release settings.
`BELL_AUDIO` contains chorus and stop-envelope settings; `BELL_SOUNDS` contains
each bell's name, attack, and partial frequencies, gains, and release-end times.
Audio times are seconds and frequencies are Hz. A partial's release-end time is
measured from its strike; the exponential release starts after the attack.
The UI controls and validation use the same configuration values.

## Check and build

```sh
npm test
npm run build
npm run preview
```

## GitHub Pages

Publish the contents of `dist/` after running `npm run build`. Vite uses relative
asset paths, so the app works under a repository subpath such as `/pause/`.
There are no server routes or backend requirements.
