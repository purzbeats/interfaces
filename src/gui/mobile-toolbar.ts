/** Mobile-friendly bottom toolbar with 6 touch buttons. */

export interface MobileToolbarCallbacks {
  onRegenerate: () => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onScreenshot: () => void;
  onShowcase: () => void;
  onToggleSettings: () => void;
  onResumeAudio: () => void;
}

export const TOOLBAR_HEIGHT = 56;

export class MobileToolbar {
  private el: HTMLDivElement;
  private styleEl: HTMLStyleElement;
  private pauseBtn!: HTMLButtonElement;
  private muteBtn!: HTMLButtonElement;
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
      @media (max-width: 767px) {
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

  private createToolbar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.id = 'mobile-toolbar';
    Object.assign(bar.style, {
      position: 'fixed',
      bottom: '0',
      left: '0',
      right: '0',
      height: `${TOOLBAR_HEIGHT}px`,
      display: 'flex',
      alignItems: 'stretch',
      justifyContent: 'space-around',
      background: 'rgba(0, 0, 0, 0.88)',
      borderTop: '1px solid rgba(51, 255, 102, 0.25)',
      zIndex: '950',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      touchAction: 'manipulation',
    });

    const buttons: { icon: string; label: string; action: () => void; ref?: 'pause' | 'mute' }[] = [
      { icon: '\u27F3', label: 'REGEN', action: () => this.fire(this.callbacks.onRegenerate) },
      { icon: '\u25B6', label: 'PLAY', action: () => this.fire(this.callbacks.onTogglePause), ref: 'pause' },
      { icon: '\u266A', label: 'SOUND', action: () => this.fire(this.callbacks.onToggleMute), ref: 'mute' },
      { icon: '\u25C9', label: 'SHOT', action: () => this.fire(this.callbacks.onScreenshot) },
      { icon: '\u229E', label: 'VIEW', action: () => this.fire(this.callbacks.onShowcase) },
      { icon: '\u2261', label: 'MENU', action: () => this.fire(this.callbacks.onToggleSettings) },
    ];

    for (const def of buttons) {
      const btn = document.createElement('button');
      btn.innerHTML = `<span style="font-size:20px;line-height:1">${def.icon}</span><br><span style="font-size:8px;letter-spacing:1px">${def.label}</span>`;
      Object.assign(btn.style, {
        flex: '1',
        background: 'none',
        border: 'none',
        borderRight: '1px solid rgba(51, 255, 102, 0.12)',
        color: '#33ff66',
        fontFamily: 'inherit',
        cursor: 'pointer',
        padding: '4px 0',
        textAlign: 'center',
        WebkitTapHighlightColor: 'transparent',
      });
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        btn.style.background = 'rgba(51, 255, 102, 0.15)';
      }, { passive: false });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        btn.style.background = 'none';
        def.action();
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        def.action();
      });
      if (def.ref === 'pause') this.pauseBtn = btn;
      if (def.ref === 'mute') this.muteBtn = btn;
      bar.appendChild(btn);
    }

    return bar;
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
    this.pauseBtn.innerHTML = `<span style="font-size:20px;line-height:1">${icon}</span><br><span style="font-size:8px;letter-spacing:1px">${label}</span>`;
  }

  setMuted(muted: boolean): void {
    const icon = muted ? '\u266A' : '\u266B';
    const label = muted ? 'MUTED' : 'SOUND';
    this.muteBtn.innerHTML = `<span style="font-size:20px;line-height:1">${icon}</span><br><span style="font-size:8px;letter-spacing:1px">${label}</span>`;
  }

  destroy(): void {
    this.el.remove();
    this.styleEl.remove();
  }
}
