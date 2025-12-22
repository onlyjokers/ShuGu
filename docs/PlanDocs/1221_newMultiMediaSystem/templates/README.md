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
  - Load Media Sound (upload) → Tone Player → Tone Delay → Audio Patch to Client
  - Requires picking an audio file in the `Load Media Sound` node (will upload to Asset Service).
  - 通过 `Audio Patch to Client(Deploy) → Client(In)` 指定播放目标。

- `03_filepicker_upload_to_tone_player.json`
  - Load Media Sound (file picker upload) → Tone Player → Audio Patch to Client
  - Requires `shugu-server-url` + `shugu-asset-write-token` set in manager.
  - 通过 `Audio Patch to Client(Deploy) → Client(In)` 指定播放目标。

- `07_patch_midi_map_delay_time.json`
  - Tone Osc → Tone Delay → Audio Patch to Client，并用 `midi-fuzzy → midi-map` 实时控制 Delay(Time)
  - MIDI 节点在 manager 运行（manager-only），不会被部署到 client；通过 override bridge 写入 patch 参数。
  - 通过 `Audio Patch to Client(Deploy) → Client(In)` 指定播放目标。

## Media (Manager command path)

- `04_media_image_show.json`
  - Load Media Image → Play Media(showImage) → Client

- `05_media_video_play.json`
  - Load Media Video → Play Media(video) → Client

## Synth(Update) (Tone single engine)

- `06_synth_update_tone.json`
  - Synth(Update) → Client (ToneModulatedSoundPlayer backend)
