<!--
Purpose: Node Graph templates to quickly verify the new multimedia system features.

How to import:
- Manager → Node Graph → `⋯` → `⬇ Import` → choose one JSON file in this folder.
-->

# Node Graph Templates (1221_newMultiMediaSystem)

## Audio (Graph-driven Patch via Audio Patch to Client)

- `01_patch_osc_delay_audio_out.json`
  - Tone Osc → Tone Delay → Audio Patch to Client
  - No assets required; best first test for音频 patch + 实时参数更新。
  - 通过 `Audio Patch to Client(Deploy) → Client(In)` 指定播放目标（不再使用 Toolbar Patch）。

- `10_tone_lfo_delay_wet.json`
  - Tone LFO（audio-rate）→ Tone Delay(Wet)
  - 演示 `tone-lfo.value → tone-delay.wet` 的连续调制（ToneAdapter 走 Tone.LFO.connect，而不是 30Hz 数值写入）。

- `02_patch_asset_player_delay_audio_out.json`
  - Load Audio From Assets → Tone Delay → Audio Patch to Client
  - Requires uploading an audio asset first in `Assets Manager`, then picking it via `Load Audio From Assets`.
  - 通过 `Audio Patch to Client(Deploy) → Client(In)` 指定播放目标。

- `03_load_audio_from_assets_timeline.json`
  - Load Audio From Assets（Timeline/Loop/Play）→ Audio Patch to Client
  - Shows the new clip Timeline (2 cursors + playhead) + Loop + Play(Pause) + Reverse + Seek controls.
  - 通过 `Audio Patch to Client(Deploy) → Client(In)` 指定播放目标。

- `07_patch_midi_map_delay_time.json`
  - Tone Osc → Tone Delay → Audio Patch to Client，并用 `midi-fuzzy → midi-map` 实时控制 Delay(Time)
  - MIDI 节点在 manager 运行（manager-only），不会被部署到 client；通过 override bridge 写入 patch 参数。
  - 通过 `Audio Patch to Client(Deploy) → Client(In)` 指定播放目标。

- `08_midi_control_audio_clip_range.json`
  - MIDI → (Start/End Sec) → Load Audio From Assets → Tone Delay
  - 演示 `startSec/endSec` 端口可接 MIDI 数字口（manager-only MIDI → override bridge）。

- `09_midi_select_waveform_tone_osc.json`
  - MIDI → Select → Tone Osc(Waveform) → Audio Patch to Client
  - 演示 select 类型参数（Waveform）现在也是“输入口”，可接线/可被 MIDI 实时调制。

## Media (Graph-driven Patch via Image/Video to Client)

- `04_media_image_show.json`
  - Load Image From Assets → Image to Client
  - 通过 `Image to Client(Deploy) → Client(In)` 指定播放目标。

- `05_media_video_play.json`
  - Load Video From Assets（Timeline/Loop/Play/Reverse/Seek）→ Video to Client
  - 通过 `Video to Client(Deploy) → Client(In)` 指定播放目标。

## Synth(Update) (Tone single engine)

- `06_synth_update_tone.json`
  - Synth(Update) → Client (ToneModulatedSoundPlayer backend)
