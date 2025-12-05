<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  function handleStart() {
    dispatch('start');
  }
</script>

<div class="start-screen">
  <div class="content">
    <h1 class="title">ShuGu</h1>
    <p class="subtitle">Interactive Art Experience</p>

    <button class="start-button" on:click={handleStart}>
      <span class="button-text">进入体验</span>
      <span class="button-subtext">Start Experience</span>
    </button>

    <p class="hint">Please allow microphone and motion sensor access</p>
  </div>

  <div class="background-glow"></div>
</div>

<style>
  .start-screen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #0a0a0f 0%, #0f0f1a 50%, #0a0a0f 100%);
    z-index: 1000;
  }

  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 2rem;
    z-index: 1;
  }

  .title {
    font-size: 4rem;
    font-weight: 700;
    background: linear-gradient(135deg, #6366f1, #ec4899);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 0.5rem;
    letter-spacing: -0.02em;
  }

  .subtitle {
    font-size: 1.25rem;
    color: #94a3b8;
    margin-bottom: 3rem;
  }

  .start-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1.5rem 4rem;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border: none;
    border-radius: 16px;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 30px rgba(99, 102, 241, 0.4);
  }

  .start-button:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 40px rgba(99, 102, 241, 0.6);
  }

  .start-button:active {
    transform: scale(0.98);
  }

  .button-text {
    font-size: 1.5rem;
    font-weight: 600;
    color: white;
  }

  .button-subtext {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.8);
    margin-top: 0.25rem;
  }

  .hint {
    margin-top: 2rem;
    font-size: 0.875rem;
    color: #64748b;
  }

  .background-glow {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 400px;
    height: 400px;
    background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%);
    pointer-events: none;
  }

  @media (max-width: 480px) {
    .title {
      font-size: 3rem;
    }

    .start-button {
      padding: 1.25rem 3rem;
    }
  }
</style>
