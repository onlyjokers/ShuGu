<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';

  const dispatch = createEventDispatcher();

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let tinyCanvas: HTMLCanvasElement;
  let tinyCtx: CanvasRenderingContext2D | null = null;
  let animationId: number;

  // Button hit area (kept invisible but clickable)
  let buttonRect = { x: 0, y: 0, w: 0, h: 0 };

  const palette: [number, number, number][] = [
    [10, 6, 18],
    [32, 10, 44],
    [68, 24, 82],
    [111, 42, 102],
    [158, 64, 103],
    [196, 96, 92],
    [228, 140, 96],
    [245, 184, 122],
    [252, 214, 160],
  ];

  function handleStart() {
    dispatch('start');
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    tinyCanvas = document.createElement('canvas');
    tinyCtx = tinyCanvas.getContext('2d');
    handleResize();
    animate();
    window.addEventListener('resize', handleResize);
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('resize', handleResize);
  });

  function handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

    const btnW = Math.min(320, width * 0.6);
    const btnH = 72;
    buttonRect = {
      x: (width - btnW) / 2,
      y: height * 0.55,
      w: btnW,
      h: btnH,
    };
  }

  function animate() {
    drawAscii(performance.now() / 1000);
    animationId = requestAnimationFrame(animate);
  }

  function drawAscii(t: number) {
    if (!ctx || !tinyCtx || !tinyCanvas) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const cellSize = 12;
    const cols = Math.max(32, Math.floor(width / cellSize));
    const rows = Math.max(24, Math.floor(height / (cellSize * 1.05)));

    tinyCanvas.width = cols;
    tinyCanvas.height = rows;

    const imageData = tinyCtx.createImageData(cols, rows);
    const data = imageData.data;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const nx = x / cols - 0.5;
        const ny = y / rows - 0.5;
        const dist = Math.sqrt(nx * nx + ny * ny);
        const swirl = Math.sin(t * 1.1 + dist * 13 + hash(x, y) * 6) * 0.08;
        const raw = 1 - dist * 1.8 + swirl + 0.06 * hash(y, x);
        const gradient = Math.min(0.78, Math.max(0, raw));
        const idx = (y * cols + x) * 4;
        const [r, g, b] = sampleColor(gradient);
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    tinyCtx.putImageData(imageData, 0, 0);

    ctx.fillStyle = '#05040a';
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = Math.max(10, Math.round(height / rows));
    ctx.font = `${fontSize}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;

    const ramp = ['.', '`', ',', ':', ';', '-', '~', '+', '*', 'x', 'o', 'O', '%', '#', '@'];
    const strokes = ['/', '\\', '|', '-', '='];
    const solid = '█';

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = (y * cols + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (brightness < 0.05) continue;

        const posX = (x + 0.5) * (width / cols);
        const posY = (y + 0.5) * (height / rows);

        let glyph: string;
        if (brightness >= 0.82) {
          glyph = solid;
        } else if (brightness > 0.62) {
          glyph = strokes[(x + y) % strokes.length];
        } else {
          glyph = ramp[Math.min(ramp.length - 1, Math.floor(brightness * ramp.length))];
        }

        const alpha = 0.32 + brightness * 0.6;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha)})`;
        ctx.fillText(glyph, posX, posY);
      }
    }

    drawBorder(ctx, width, height, cols, rows);
    drawUi(ctx, width, height, cols, rows);
  }

  function drawUi(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cols: number,
    rows: number
  ) {
    const charW = width / cols;
    const charH = height / rows;
    const title = 'FLUFFY FOUNDATION';
    const subtitle = 'Made by Fluffy Core Team';
    const hint = 'Eureka, Starno, VKong';
    const buttonLabel = '[ ENTER ]';

    ctx.fillStyle = 'rgba(255, 228, 210, 0.8)';
    // Increase title size significantly, but constrain to viewport width
    const titleSize = Math.max(24, Math.round(charH * 2.5));
    ctx.font = `${titleSize}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;
    // Pass width * 0.9 as maxWidth to ensure it never overflows/wraps
    ctx.fillText(title, width / 2, height * 0.32, width * 0.9);

    ctx.font = `${Math.max(11, Math.round(charH * 1.05))}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;
    ctx.fillStyle = 'rgba(214, 201, 192, 0.7)';
    ctx.fillText(subtitle, width / 2, height * 0.38);

    // ASCII button boxes
    drawAsciiButton(ctx, buttonRect, buttonLabel, charW, charH);

    // Hint text - move to bottom
    ctx.font = `${Math.max(10, Math.round(charH * 0.95))}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;
    ctx.fillStyle = 'rgba(158, 143, 132, 0.8)';
    // Position at roughly 90% height or 2 rows from bottom
    ctx.fillText(hint, width / 2, height - charH * 2.5);
  }

  function drawBorder(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cols: number,
    rows: number
  ) {
    const edgeColor = 'rgba(255, 228, 210, 0.55)';
    ctx.fillStyle = edgeColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const charW = width / cols;
    const charH = height / rows;
    ctx.font = `${Math.max(10, Math.round(charH * 0.95))}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;

    const topChars = ['=', '-', '='];
    const sideChars = ['|', '!', '|'];

    for (let c = 0; c < cols; c++) {
      const ch = topChars[c % topChars.length];
      const x = c * charW + charW / 2;
      ctx.fillText(ch, x, charH * 0.55);
      ctx.fillText(ch, x, height - charH * 0.45);
    }

    for (let r = 0; r < rows; r++) {
      const ch = sideChars[r % sideChars.length];
      const y = r * charH + charH / 2;
      ctx.fillText(ch, charW * 0.45, y);
      ctx.fillText(ch, width - charW * 0.45, y);
    }

    ctx.fillText('+', charW * 0.45, charH * 0.55);
    ctx.fillText('+', width - charW * 0.45, charH * 0.55);
    ctx.fillText('+', charW * 0.45, height - charH * 0.45);
    ctx.fillText('+', width - charW * 0.45, height - charH * 0.45);
  }

  function sampleColor(t: number): [number, number, number] {
    const clamped = Math.min(1, Math.max(0, t));
    const pos = clamped * (palette.length - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(palette.length - 1, i0 + 1);
    const frac = pos - i0;
    const c0 = palette[i0];
    const c1 = palette[i1];
    return [
      Math.round(c0[0] + (c1[0] - c0[0]) * frac),
      Math.round(c0[1] + (c1[1] - c0[1]) * frac),
      Math.round(c0[2] + (c1[2] - c0[2]) * frac),
    ];
  }

  function hash(x: number, y: number): number {
    let n = x * 374761393 + y * 668265263;
    n = (n ^ (n >> 13)) * 1274126177;
    n ^= n >> 16;
    return (n >>> 0) / 0xffffffff;
  }

  function drawAsciiButton(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    label: string,
    charW: number,
    charH: number
  ) {
    const bw = rect.w;
    const bh = rect.h;
    const bx = rect.x;
    const by = rect.y;
    const borderColor = 'rgba(255, 228, 210, 0.75)';
    ctx.fillStyle = borderColor;
    ctx.font = `${Math.max(12, Math.round(charH * 1.05))}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;
    const dash = '=';
    const pipe = '|';
    const corner = '+';
    const blocksX = Math.max(6, Math.floor(bw / charW));
    const blocksY = Math.max(3, Math.floor(bh / charH));

    for (let i = 0; i < blocksX; i++) {
      const x = bx + (i + 0.5) * charW;
      ctx.fillText(dash, x, by + charH * 0.6);
      ctx.fillText(dash, x, by + blocksY * charH - charH * 0.4);
    }
    for (let j = 0; j < blocksY; j++) {
      const y = by + (j + 0.5) * charH;
      ctx.fillText(pipe, bx + charW * 0.4, y);
      ctx.fillText(pipe, bx + blocksX * charW - charW * 0.4, y);
    }
    ctx.fillText(corner, bx + charW * 0.4, by + charH * 0.6);
    ctx.fillText(corner, bx + blocksX * charW - charW * 0.4, by + charH * 0.6);
    ctx.fillText(corner, bx + charW * 0.4, by + blocksY * charH - charH * 0.4);
    ctx.fillText(corner, bx + blocksX * charW - charW * 0.4, by + blocksY * charH - charH * 0.4);

    ctx.fillStyle = 'rgba(255, 228, 210, 0.9)';
    ctx.font = `${Math.max(14, Math.round(charH * 1.1))}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + charH * 0.05);
  }
</script>

<div class="start-screen">
  <canvas class="ascii-bg" bind:this={canvas}></canvas>
  <button
    class="click-target"
    aria-label="Enter"
    on:click={handleStart}
    style={`left:${buttonRect.x}px;top:${buttonRect.y}px;width:${buttonRect.w}px;height:${buttonRect.h}px;`}
    >Enter</button
  >
</div>

<style>
  .start-screen {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #05040a;
    overflow: hidden;
    z-index: 1000;
  }

  .ascii-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }

  .click-target {
    position: absolute;
    z-index: 1;
    background: transparent;
    border: none;
    color: transparent;
    opacity: 0;
    cursor: pointer;
  }

  .click-target:focus-visible {
    outline: 2px dashed rgba(255, 228, 210, 0.6);
    outline-offset: 4px;
  }
</style>
