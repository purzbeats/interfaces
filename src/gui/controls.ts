import GUI from 'lil-gui';
import type { Config } from '../config';
import { ASPECT_RATIOS } from '../config';
import type { AudioSynth } from '../audio/synth';
import type { AudioReactive } from '../audio/audio-reactive';
import { paletteNames } from '../color/palettes';
import { templateNames } from '../layout/templates';
import { setDividerBrightness, setDividerThickness } from '../elements/separator';
import { openPaletteEditor } from './palette-editor';

export interface GUIControls {
  gui: GUI;
  visible: boolean;
  toggle(): void;
  destroy(): void;
}

export function createGUI(
  config: Config,
  onRegenerate: () => void,
  onScreenshot: () => void,
  onRecord: () => void,
  audio: AudioSynth,
  playback?: { onPause: () => void; onRestart: () => void; onLoopToggle: (v: boolean) => void },
  onAspectChange?: () => void,
  audioReactive?: AudioReactive,
): GUIControls {
  const gui = new GUI({ title: 'INTERFACES' });
  gui.domElement.style.zIndex = '1000';

  // Generation
  const genFolder = gui.addFolder('Generation');
  genFolder.add(config, 'seed', 0, 99999, 1).name('Seed').onFinishChange(onRegenerate);
  const paletteCtrl = genFolder.add(config, 'palette', paletteNames()).name('Palette').onChange(onRegenerate);
  genFolder.add({
    editPalette: () => {
      openPaletteEditor({
        currentPalette: config.palette,
        onChange: (name: string) => {
          config.palette = name;
          onRegenerate();
        },
        onRefreshList: () => {
          // Rebuild the palette dropdown options
          const select = paletteCtrl.domElement.querySelector('select');
          if (select) {
            select.innerHTML = '';
            for (const n of paletteNames()) {
              const opt = document.createElement('option');
              opt.value = n;
              opt.textContent = n;
              if (n === config.palette) opt.selected = true;
              select.appendChild(opt);
            }
          }
        },
      });
    }
  }, 'editPalette').name('Edit Palette...');
  genFolder.add(config, 'template', templateNames()).name('Template').onChange(onRegenerate);
  genFolder.add(config, 'hexLayout').name('Hex Layout (X)').onChange(onRegenerate);
  genFolder.add(config, 'aspectRatio', ASPECT_RATIOS).name('Aspect Ratio').onChange(() => {
    if (onAspectChange) onAspectChange();
  });
  genFolder.add(config, 'overscanPadding', 0, 100, 1).name('Overscan (+/-)').onChange(() => {
    if (onAspectChange) onAspectChange();
  });
  genFolder.add(config, 'overscanX', -100, 100, 1).name('Overscan X').onChange(() => {
    if (onAspectChange) onAspectChange();
  });
  genFolder.add(config, 'overscanY', -100, 100, 1).name('Overscan Y').onChange(() => {
    if (onAspectChange) onAspectChange();
  });
  genFolder.add(config, 'dividerBrightness', 0, 3, 0.05).name('Divider Brightness').onChange((v: number) => {
    setDividerBrightness(v);
  });
  genFolder.add(config, 'dividerThickness', 1, 5, 0.5).name('Divider Thickness').onChange((v: number) => {
    setDividerThickness(v);
  });
  genFolder.add({ regenerate: onRegenerate }, 'regenerate').name('Regenerate (R)');
  genFolder.add({
    copyURL: () => {
      navigator.clipboard.writeText(window.location.href);
    }
  }, 'copyURL').name('Copy Seed URL');

  // Playback
  if (playback) {
    const pbFolder = gui.addFolder('Playback');
    pbFolder.add({ pausePlay: playback.onPause }, 'pausePlay').name('Pause / Play (Space)');
    pbFolder.add({ restart: playback.onRestart }, 'restart').name('Restart (Backspace)');
    pbFolder.add({ loop: true }, 'loop').name('Continuous (L)').onChange(playback.onLoopToggle);
    pbFolder.add(config, 'rollingSwap').name('Rolling Swap');
    pbFolder.add(config, 'rollingInterval', 2, 15, 0.5).name('Swap Interval (s)');
  }

  // Audio
  const audioFolder = gui.addFolder('Audio');
  const audioState = { muted: audio.muted, volume: audio.volume };
  audioFolder.add(audioState, 'muted').name('Mute (M)').onChange((v: boolean) => { audio.muted = v; });
  audioFolder.add(audioState, 'volume', 0, 0.5, 0.01).name('Volume').onChange((v: number) => { audio.volume = v; });

  // Audio Reactive
  if (audioReactive) {
    const arFolder = gui.addFolder('Audio Reactive');
    const arState = { source: 'Off' as string };

    // Hidden file input for audio file selection
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) {
        audioReactive.startFile(file).catch(() => {
          arState.source = 'Off';
          audioReactive.stop();
          sourceCtrl.updateDisplay();
        });
      } else {
        // No file selected — revert to Off
        arState.source = 'Off';
        audioReactive.stop();
        sourceCtrl.updateDisplay();
      }
      fileInput.value = '';
    });

    const sourceCtrl = arFolder.add(arState, 'source', ['Off', 'Microphone', 'File']).name('Source').onChange((v: string) => {
      switch (v) {
        case 'Off':
          audioReactive.stop();
          break;
        case 'Microphone':
          audioReactive.startMic().catch(() => {
            arState.source = 'Off';
            audioReactive.stop();
            sourceCtrl.updateDisplay();
          });
          break;
        case 'File':
          fileInput.click();
          break;
      }
    });

    arFolder.add(audioReactive, 'sensitivity', 0.5, 3.0, 0.1).name('Sensitivity');
    arFolder.add(config.audioReactive, 'flicker').name('Flicker');
    arFolder.add(config.audioReactive, 'jiggle').name('Jiggle');
  }

  // Post-FX
  const fxFolder = gui.addFolder('Post-FX');
  fxFolder.add(config.postfx, 'bloom').name('Bloom');
  fxFolder.add(config.postfx, 'bloomStrength', 0, 3, 0.05).name('Bloom Strength');
  fxFolder.add(config.postfx, 'bloomRadius', 0, 1, 0.05).name('Bloom Radius');
  fxFolder.add(config.postfx, 'bloomThreshold', 0, 1, 0.05).name('Bloom Threshold');
  fxFolder.add(config.postfx, 'crt').name('CRT');
  fxFolder.add(config.postfx, 'crtIntensity', 0, 2, 0.05).name('CRT Intensity');
  fxFolder.add(config.postfx, 'chromatic').name('Chromatic Aberration');
  fxFolder.add(config.postfx, 'chromaticIntensity', 0, 2, 0.05).name('Chrom. Intensity');
  fxFolder.add(config.postfx, 'vignette').name('Vignette');
  fxFolder.add(config.postfx, 'vignetteIntensity', 0, 2, 0.05).name('Vignette Intensity');
  fxFolder.add(config.postfx, 'noise').name('Film Grain');
  fxFolder.add(config.postfx, 'noiseIntensity', 0, 0.5, 0.01).name('Grain Intensity');
  fxFolder.add(config.postfx, 'flicker').name('Flicker');
  fxFolder.add(config.postfx, 'flickerIntensity', 0, 0.2, 0.005).name('Flicker Intensity');
  fxFolder.close();

  // Timeline
  const tlFolder = gui.addFolder('Timeline');
  tlFolder.add(config.timeline, 'bootDuration', 0.5, 10, 0.5).name('Boot (s)');
  tlFolder.add(config.timeline, 'mainDuration', 5, 60, 1).name('Main (s)');
  tlFolder.add(config.timeline, 'alertDuration', 1, 15, 0.5).name('Alert (s)');
  tlFolder.add(config.timeline, 'cooldownDuration', 1, 15, 0.5).name('Cooldown (s)');
  tlFolder.close();

  // Export
  const exportFolder = gui.addFolder('Export');
  exportFolder.add({ screenshot: onScreenshot }, 'screenshot').name('Screenshot (S)');
  exportFolder.add({ record: onRecord }, 'record').name('Record Video');
  exportFolder.add(config.export, 'fps', 24, 60, 1).name('Video FPS');
  exportFolder.add(config.export, 'duration', 5, 120, 1).name('Video Duration');
  exportFolder.close();

  // Close button — insert into the title bar
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00d7';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '0',
    left: '4px',
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: '16px',
    cursor: 'pointer',
    lineHeight: '26px',
    padding: '0 4px',
    zIndex: '1',
  });
  // lil-gui title bar is the first .title element
  const titleBar = gui.domElement.querySelector('.title');
  if (titleBar) {
    (titleBar as HTMLElement).style.position = 'relative';
    titleBar.appendChild(closeBtn);
  } else {
    gui.domElement.appendChild(closeBtn);
  }

  // Start hidden until first click
  let visible = false;
  gui.domElement.style.display = 'none';

  const hide = () => {
    visible = false;
    gui.domElement.style.display = 'none';
  };

  const show = () => {
    visible = true;
    gui.domElement.style.display = '';
  };

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hide();
  });

  const showOnClick = () => {
    show();
    window.removeEventListener('click', showOnClick);
  };
  // On mobile, the toolbar's MENU button drives settings visibility instead
  if (!matchMedia('(max-width: 767px) and (pointer: coarse)').matches) {
    window.addEventListener('click', showOnClick);
  }

  return {
    gui,
    get visible() { return visible; },
    toggle() {
      if (visible) hide(); else show();
    },
    destroy() {
      window.removeEventListener('click', showOnClick);
      gui.destroy();
    },
  };
}
