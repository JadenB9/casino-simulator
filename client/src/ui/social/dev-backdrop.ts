// Dev pages only (lobby, chat, feats, social): ?scene=0 paints a still picture of the casino's
// colours (a dark room over a lit red carpet) on the scene's canvas in place of the 3D room, so a
// headless screenshot of a panel needs no WebGL. The panels still sit over something like the floor.

export function sceneWanted(): boolean {
  return new URLSearchParams(location.search).get('scene') !== '0';
}

export function stillBackdrop(canvas: HTMLCanvasElement): void {
  const paint = () => {
    const w = (canvas.width = innerWidth);
    const h = (canvas.height = innerHeight);
    const g = canvas.getContext('2d');
    if (!g) return;
    const wall = g.createLinearGradient(0, 0, 0, h * 0.45);
    wall.addColorStop(0, '#060504');
    wall.addColorStop(1, '#14100c');
    g.fillStyle = wall;
    g.fillRect(0, 0, w, h);
    const floor = g.createRadialGradient(w * 0.5, h * 0.72, 10, w * 0.5, h * 0.72, Math.max(w, h) * 0.7);
    floor.addColorStop(0, '#7a1a10');
    floor.addColorStop(0.45, '#3d0b07');
    floor.addColorStop(1, '#160404');
    g.fillStyle = floor;
    g.fillRect(0, h * 0.42, w, h);
    // a felt table in the light, for something bright behind the panels
    g.fillStyle = '#1f6b43';
    g.beginPath();
    g.ellipse(w * 0.42, h * 0.6, w * 0.2, h * 0.08, 0, 0, Math.PI * 2);
    g.fill();
  };
  paint();
  addEventListener('resize', paint);
}
