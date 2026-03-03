import * as THREE from 'three';

export interface Palette {
  name: string;
  bg: THREE.Color;
  primary: THREE.Color;
  secondary: THREE.Color;
  dim: THREE.Color;
  alert: THREE.Color;
}

function p(name: string, bg: string, primary: string, secondary: string, dim: string, alert: string): Palette {
  return {
    name,
    bg: new THREE.Color(bg),
    primary: new THREE.Color(primary),
    secondary: new THREE.Color(secondary),
    dim: new THREE.Color(dim),
    alert: new THREE.Color(alert),
  };
}

export const PALETTES: Record<string, Palette> = {
  'phosphor-green': p('phosphor-green', '#0a0a0a', '#33ff66', '#22cc44', '#0d4422', '#ff3333'),
  'amber': p('amber', '#0a0800', '#ffaa00', '#cc8800', '#443300', '#ff4444'),
  'cyan-magenta': p('cyan-magenta', '#050510', '#00ffff', '#ff00ff', '#1a1a3a', '#ffff00'),
  'military': p('military', '#0a0d0a', '#88cc88', '#669966', '#2a3a2a', '#ff6633'),
  'ice-blue': p('ice-blue', '#04080c', '#44aaff', '#2288dd', '#0d2233', '#ff5555'),
  'synthwave': p('synthwave', '#0d0020', '#ff66ff', '#6644ff', '#1a0033', '#00ffaa'),
  'backrooms': p('backrooms', '#1a1708', '#d4c36a', '#a89640', '#3d3518', '#cc4444'),
  'bioluminescent': p('bioluminescent', '#040d0d', '#00e5a0', '#0099cc', '#0a3333', '#ff3366'),
};

export function getPalette(name: string): Palette {
  return PALETTES[name] ?? PALETTES['phosphor-green'];
}

export function paletteNames(): string[] {
  return Object.keys(PALETTES);
}
