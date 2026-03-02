/** Mobile-friendly two-row bottom toolbar with touch controls. */

export interface MobileToolbarCallbacks {
  onRegenerate: () => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onScreenshot: () => void;
  onShowcase: () => void;
  onGallery: () => void;
  onToggleLoop: () => void;
  onToggleSettings: () => void;
  onResumeAudio: () => void;
  onIntensity: (level: number) => void;
}

const ROW_HEIGHT = 48;
export const TOOLBAR_HEIGHT = ROW_HEIGHT * 2;

export class MobileToolbar {
  private el: HTMLDivElement;
  private styleEl: HTMLStyleElement;
  private pauseBtn!: HTMLButtonElement;
  private muteBtn!: HTMLButtonElement;
  private loopBtn!: HTMLButtonElement;
  private intensityBtns: HTMLButtonElement[] = [];
  private activeIntensity: number = 0;
  private audioResumed = false;
  private callbacks: MobileToolbarCallbacks;

  constructor(callbacks: MobileToolbarCallbacks) {
    this.callbacks = callbacks;
    this.styleEl = this.injectStyles();
    this.el = this.createToolbar();
    document.body.appendChild(this.el);
  }

  private injectStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.id = 'mobile-toolbar-styles';
    style.textContent = `
      @media (max-width: 767px) and (pointer: coarse) {
        .lil-gui.root {
          position: fixed !important;
          top: auto !important;
          bottom: ${TOOLBAR_HEIGHT}px !important;
          left: 0 !important;
          right: 0 !important;
          width: 100% !important;
          max-height: 60vh !important;
          overflow-y: auto !important;
          z-index: 1000 !important;
          border-radius: 0 !important;
        }
      }
    `;
    document.head.appendChild(style);
    return style;
  }

  private makeBtn(icon: string, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.innerHTML = `<span style="font-size:18px;line-height:1">${icon}</span><br><span style="font-size:7px;letter-spacing:1px">${label}</span>`;
    Object.assign(btn.style, {
      flex: '1',
      background: 'none',
      border: 'none',
      borderRight: '1px solid rgba(51, 255, 102, 0.12)',
      color: '#33ff66',
      fontFamily: 'inherit',
      cursor: 'pointer',
      padding: '2px 0',
      textAlign: 'center',
      WebkitTapHighlightColor: 'transparent',
      minWidth: '0',
    });
    return btn;
  }

  private wireTap(btn: HTMLButtonElement, action: () => void): void {
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      btn.style.background = 'rgba(51, 255, 102, 0.15)';
    }, { passive: false });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      btn.style.background = 'none';
      action();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      action();
    });
  }

  private createToolbar(): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.id = 'mobile-toolbar';
    Object.assign(wrapper.style, {
      position: 'fixed',
      bottom: '0',
      left: '0',
      right: '0',
      height: `${TOOLBAR_HEIGHT}px`,
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(0, 0, 0, 0.88)',
      borderTop: '1px solid rgba(51, 255, 102, 0.25)',
      zIndex: '950',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      touchAction: 'manipulation',
    });

    // --- Top row: core controls ---
    const topRow = document.createElement('div');
    Object.assign(topRow.style, {
      display: 'flex',
      alignItems: 'stretch',
      height: `${ROW_HEIGHT}px`,
      borderBottom: '1px solid rgba(51, 255, 102, 0.12)',
    });

    const regen = this.makeBtn('\u27F3', 'REGEN');
    this.wireTap(regen, () => this.fire(this.callbacks.onRegenerate));

    this.pauseBtn = this.makeBtn('\u25B6', 'PLAY');
    this.wireTap(this.pauseBtn, () => this.fire(this.callbacks.onTogglePause));

    this.muteBtn = this.makeBtn('\u266A', 'SOUND');
    this.wireTap(this.muteBtn, () => this.fire(this.callbacks.onToggleMute));

    const shot = this.makeBtn('\u25C9', 'SHOT');
    this.wireTap(shot, () => this.fire(this.callbacks.onScreenshot));

    const menu = this.makeBtn('\u2261', 'MENU');
    this.wireTap(menu, () => this.fire(this.callbacks.onToggleSettings));

    topRow.append(regen, this.pauseBtn, this.muteBtn, shot, menu);

    // --- Bottom row: modes + intensity ---
    const botRow = document.createElement('div');
    Object.assign(botRow.style, {
      display: 'flex',
      alignItems: 'stretch',
      height: `${ROW_HEIGHT}px`,
    });

    const showcase = this.makeBtn('\u229E', 'SHOW');
    this.wireTap(showcase, () => this.fire(this.callbacks.onShowcase));

    const gallery = this.makeBtn('\u25A6', 'GRID');
    this.wireTap(gallery, () => this.fire(this.callbacks.onGallery));

    this.loopBtn = this.makeBtn('\u21BB', 'LOOP');
    this.wireTap(this.loopBtn, () => this.fire(this.callbacks.onToggleLoop));

    // Intensity strip: 5 segments
    const strip = document.createElement('div');
    Object.assign(strip.style, {
      flex: '2.5',
      display: 'flex',
      alignItems: 'stretch',
      borderRight: '1px solid rgba(51, 255, 102, 0.12)',
    });

    for (let i = 1; i <= 5; i++) {
      const seg = document.createElement('button');
      seg.textContent = String(i);
      Object.assign(seg.style, {
        flex: '1',
        background: 'none',
        border: 'none',
        borderRight: i < 5 ? '1px solid rgba(51, 255, 102, 0.06)' : 'none',
        color: 'rgba(51, 255, 102, 0.4)',
        fontFamily: 'inherit',
        fontSize: '14px',
        fontWeight: 'bold',
        cursor: 'pointer',
        padding: '0',
        textAlign: 'center',
        WebkitTapHighlightColor: 'transparent',
      });

      // Press-and-hold for intensity
      seg.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.setIntensity(i);
        this.fire(() => this.callbacks.onIntensity(i));
      }, { passive: false });
      seg.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.setIntensity(0);
        this.fire(() => this.callbacks.onIntensity(0));
      });
      seg.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.setIntensity(i);
        this.fire(() => this.callbacks.onIntensity(i));
      });
      seg.addEventListener('mouseup', (e) => {
        e.preventDefault();
        this.setIntensity(0);
        this.fire(() => this.callbacks.onIntensity(0));
      });

      this.intensityBtns.push(seg);
      strip.appendChild(seg);
    }

    // Label above the strip
    const stripLabel = document.createElement('div');
    stripLabel.textContent = 'INTENSITY';
    Object.assign(stripLabel.style, {
      position: 'absolute',
      bottom: `${ROW_HEIGHT - 2}px`,
      right: '0',
      width: strip.style.flex, // doesn't work directly, use the strip's bounds
      fontSize: '6px',
      letterSpacing: '1px',
      color: 'rgba(51, 255, 102, 0.3)',
      textAlign: 'center',
      pointerEvents: 'none',
    });

    botRow.append(showcase, gallery, this.loopBtn, strip);

    wrapper.append(topRow, botRow);
    return wrapper;
  }

  private setIntensity(level: number): void {
    this.activeIntensity = level;
    for (let i = 0; i < 5; i++) {
      const seg = this.intensityBtns[i];
      if (i < level) {
        const heat = (i + 1) / 5;
        const r = Math.round(51 + heat * 204);
        const g = Math.round(255 - heat * 155);
        const b = Math.round(102 - heat * 80);
        seg.style.background = `rgba(${r}, ${g}, ${b}, 0.3)`;
        seg.style.color = `rgb(${r}, ${g}, ${b})`;
      } else {
        seg.style.background = 'none';
        seg.style.color = 'rgba(51, 255, 102, 0.4)';
      }
    }
  }

  private fire(fn: () => void): void {
    if (!this.audioResumed) {
      this.audioResumed = true;
      this.callbacks.onResumeAudio();
    }
    fn();
  }

  setPaused(paused: boolean): void {
    const icon = paused ? '\u25B6' : '\u23F8';
    const label = paused ? 'PLAY' : 'PAUSE';
    this.pauseBtn.innerHTML = `<span style="font-size:18px;line-height:1">${icon}</span><br><span style="font-size:7px;letter-spacing:1px">${label}</span>`;
  }

  setMuted(muted: boolean): void {
    const icon = muted ? '\u266A' : '\u266B';
    const label = muted ? 'MUTED' : 'SOUND';
    this.muteBtn.innerHTML = `<span style="font-size:18px;line-height:1">${icon}</span><br><span style="font-size:7px;letter-spacing:1px">${label}</span>`;
  }

  setLoop(loop: boolean): void {
    this.loopBtn.style.color = loop ? '#33ff66' : 'rgba(51, 255, 102, 0.4)';
    this.loopBtn.style.background = loop ? 'rgba(51, 255, 102, 0.12)' : 'none';
  }

  destroy(): void {
    this.el.remove();
    this.styleEl.remove();
  }
}
