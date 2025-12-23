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

- `02_patch_asset_player_delay_audio_out.json`
  - Load Audio From Assets → Tone Player → Tone Delay → Audio Patch to Client
  - Requires uploading an audio asset first in `Assets Manager`, then picking it via `Load Audio From Assets`.
  - 通过 `Audio Patch to Client(Deploy) → Client(In)` 指定播放目标。

- `03_load_audio_from_assets_timeline.json`
  - Load Audio From Assets（Timeline/Loop/Play）→ Tone Player → Audio Patch to Client
  - Shows the new clip Timeline (2 cursors + playhead) + Loop + Play(Pause) + Reverse + Seek controls.
  - 通过 `Audio Patch to Client(Deploy) → Client(In)` 指定播放目标。

- `07_patch_midi_map_delay_time.json`
  - Tone Osc → Tone Delay → Audio Patch to Client，并用 `midi-fuzzy → midi-map` 实时控制 Delay(Time)
  - MIDI 节点在 manager 运行（manager-only），不会被部署到 client；通过 override bridge 写入 patch 参数。
  - 通过 `Audio Patch to Client(Deploy) → Client(In)` 指定播放目标。

- `08_midi_control_audio_clip_range.json`
  - MIDI → (Start/End Sec) → Load Audio From Assets → Tone Player
  - 演示 `startSec/endSec` 端口可接 MIDI 数字口（manager-only MIDI → override bridge）。

## Media (Manager command path)

- `04_media_image_show.json`
  - Load Image From Assets → Play Media(showImage) → Client

- `05_media_video_play.json`
  - Load Video From Assets（Timeline/Loop/Play/Reverse/Seek）→ Play Media(video) → Client

## Synth(Update) (Tone single engine)

- `06_synth_update_tone.json`
  - Synth(Update) → Client (ToneModulatedSoundPlayer backend)
