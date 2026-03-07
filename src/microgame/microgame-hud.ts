/**
 * DOM overlay for microgame mode: prompt text, timer bar, score, lives,
 * game canvas overlay, narrator quips, and interstitials. All styling is inline.
 */

const FONT = '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace';
const GREEN = '#33ff66';
const RED = '#ff3344';
const DIM = 'rgba(51, 255, 102, 0.4)';
const BG = 'rgba(0, 0, 0, 0.85)';

export class MicrogameHUD {
  private root: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private timerBar: HTMLDivElement;
  private timerFill: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private livesEl: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private readyEl: HTMLDivElement;
  private readyMain: HTMLDivElement;
  private readyQuip: HTMLDivElement;

  /** Canvas overlay for microgames to draw their game objects on */
  readonly gameCanvas: HTMLCanvasElement;
  private gameCtx: CanvasRenderingContext2D;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'microgame-hud';
    Object.assign(this.root.style, {
      position: 'fixed', inset: '0',
      pointerEvents: 'none', zIndex: '800',
      fontFamily: FONT, display: 'none',
    });

    // Game canvas overlay (fills viewport, games draw targets/zones/etc. here)
    this.gameCanvas = document.createElement('canvas');
    Object.assign(this.gameCanvas.style, {
      position: 'absolute', inset: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none',
    });
    this.gameCtx = this.gameCanvas.getContext('2d')!;
    this.root.appendChild(this.gameCanvas);

    // Prompt text (top center)
    this.promptEl = document.createElement('div');
    Object.assign(this.promptEl.style, {
      position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)',
      fontSize: '24px', fontWeight: 'bold', color: GREEN,
      textTransform: 'uppercase', letterSpacing: '4px',
      textShadow: `0 0 20px ${GREEN}, 0 2px 8px rgba(0,0,0,0.9)`,
      textAlign: 'center', whiteSpace: 'nowrap',
    });
    this.root.appendChild(this.promptEl);

    // Timer bar (top, full width)
    this.timerBar = document.createElement('div');
    Object.assign(this.timerBar.style, {
      position: 'absolute', top: '0', left: '0', right: '0', height: '4px',
      background: 'rgba(51, 255, 102, 0.15)',
    });
    this.timerFill = document.createElement('div');
    Object.assign(this.timerFill.style, {
      height: '100%', background: GREEN,
      transition: 'width 0.05s linear',
      boxShadow: `0 0 8px ${GREEN}`,
    });
    this.timerBar.appendChild(this.timerFill);
    this.root.appendChild(this.timerBar);

    // Score (top-right)
    this.scoreEl = document.createElement('div');
    Object.assign(this.scoreEl.style, {
      position: 'absolute', top: '10px', right: '16px',
      fontSize: '18px', color: GREEN, letterSpacing: '2px',
      textShadow: `0 0 10px ${GREEN}`,
    });
    this.root.appendChild(this.scoreEl);

    // Lives (top-left)
    this.livesEl = document.createElement('div');
    Object.assign(this.livesEl.style, {
      position: 'absolute', top: '10px', left: '16px',
      fontSize: '18px', color: GREEN, letterSpacing: '2px',
    });
    this.root.appendChild(this.livesEl);

    // Speed indicator (below score)
    this.speedEl = document.createElement('div');
    Object.assign(this.speedEl.style, {
      position: 'absolute', top: '34px', right: '16px',
      fontSize: '10px', color: DIM, letterSpacing: '1px',
      textTransform: 'uppercase',
    });
    this.root.appendChild(this.speedEl);

    // Full-screen flash for win/lose feedback
    this.flashEl = document.createElement('div');
    Object.assign(this.flashEl.style, {
      position: 'absolute', inset: '0',
      opacity: '0', transition: 'opacity 0.15s',
      pointerEvents: 'none',
    });
    this.root.appendChild(this.flashEl);

    // Interstitial (two-part: main text + narrator quip)
    this.readyEl = document.createElement('div');
    Object.assign(this.readyEl.style, {
      position: 'absolute', inset: '0',
      display: 'none', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '16px',
      background: BG,
    });

    this.readyMain = document.createElement('div');
    Object.assign(this.readyMain.style, {
      fontSize: '48px', fontWeight: 'bold', color: GREEN,
      textTransform: 'uppercase', letterSpacing: '8px',
      textShadow: `0 0 30px ${GREEN}`,
      textAlign: 'center', lineHeight: '1.2',
    });

    this.readyQuip = document.createElement('div');
    Object.assign(this.readyQuip.style, {
      fontSize: '13px', color: DIM, letterSpacing: '2px',
      textAlign: 'center', maxWidth: '500px', lineHeight: '1.6',
      whiteSpace: 'pre-line',
    });

    this.readyEl.appendChild(this.readyMain);
    this.readyEl.appendChild(this.readyQuip);
    this.root.appendChild(this.readyEl);

    document.body.appendChild(this.root);
  }

  show(): void { this.root.style.display = ''; }
  hide(): void { this.root.style.display = 'none'; }

  /** Resize game canvas to match viewport (call on enter and resize) */
  resizeGameCanvas(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.gameCanvas.width = Math.round(window.innerWidth * dpr);
    this.gameCanvas.height = Math.round(window.innerHeight * dpr);
    this.gameCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Get the 2D context for the game canvas overlay */
  getGameContext(): CanvasRenderingContext2D {
    return this.gameCtx;
  }

  /** Clear the game canvas */
  clearGameCanvas(): void {
    this.gameCtx.clearRect(0, 0, this.gameCanvas.width, this.gameCanvas.height);
  }

  setPrompt(text: string): void {
    this.promptEl.textContent = text;
  }

  setTimer(fraction: number): void {
    const pct = Math.max(0, Math.min(1, fraction)) * 100;
    this.timerFill.style.width = `${pct}%`;
    if (fraction < 0.25) {
      this.timerFill.style.background = RED;
      this.timerFill.style.boxShadow = `0 0 8px ${RED}`;
    } else {
      this.timerFill.style.background = GREEN;
      this.timerFill.style.boxShadow = `0 0 8px ${GREEN}`;
    }
  }

  setScore(score: number): void {
    this.scoreEl.textContent = `${score}`;
  }

  setLives(lives: number): void {
    this.livesEl.textContent = '\u2588 '.repeat(lives).trim();
    this.livesEl.style.color = lives <= 1 ? RED : GREEN;
  }

  setSpeed(level: number): void {
    this.speedEl.textContent = `SPD ${level}`;
  }

  flash(win: boolean): void {
    const color = win ? 'rgba(51, 255, 102, 0.2)' : 'rgba(255, 51, 68, 0.25)';
    this.flashEl.style.background = color;
    this.flashEl.style.opacity = '1';
    setTimeout(() => { this.flashEl.style.opacity = '0'; }, 200);
  }

  /** Show interstitial with main text and optional narrator quip */
  showInterstitial(text: string, quip?: string): void {
    this.readyMain.textContent = text;
    this.readyQuip.textContent = quip ?? '';
    this.readyQuip.style.display = quip ? '' : 'none';
    this.readyEl.style.display = 'flex';
  }

  /** Update just the quip text without changing the main text */
  setQuip(quip: string): void {
    this.readyQuip.textContent = quip;
    this.readyQuip.style.display = quip ? '' : 'none';
  }

  hideInterstitial(): void {
    this.readyEl.style.display = 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
