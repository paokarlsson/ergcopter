// Ritfunktioner för helikoptern och landskapet. Koordinater kring helikopterns
// mitt, nosen åt höger, skala 1 ≈ 250 px rotordiameter.

export function drawHelicopter(ctx, rotor, c) {
  const blur = rotor.blur;

  // Stjärtbom och fena
  ctx.fillStyle = c.body;
  ctx.beginPath();
  ctx.moveTo(-34, -8);
  ctx.lineTo(-112, -4);
  ctx.lineTo(-112, 3);
  ctx.lineTo(-34, 8);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-100, -3);
  ctx.lineTo(-116, -24);
  ctx.lineTo(-122, -24);
  ctx.lineTo(-114, 3);
  ctx.fill();

  // Stjärtrotor
  ctx.save();
  ctx.translate(-116, -12);
  ctx.globalAlpha = 0.15 + 0.3 * blur;
  ctx.fillStyle = c.rotor;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1 - 0.6 * blur;
  ctx.strokeStyle = c.rotor;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(Math.cos(rotor.tailAngle) * 13, Math.sin(rotor.tailAngle) * 13);
  ctx.lineTo(-Math.cos(rotor.tailAngle) * 13, -Math.sin(rotor.tailAngle) * 13);
  ctx.stroke();
  ctx.restore();

  // Medar
  ctx.strokeStyle = c.metal;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, 18);
  ctx.lineTo(-22, 32);
  ctx.moveTo(16, 18);
  ctx.lineTo(22, 32);
  ctx.moveTo(-42, 32);
  ctx.lineTo(40, 32);
  ctx.quadraticCurveTo(50, 32, 52, 25);
  ctx.stroke();

  // Kropp och ruta
  ctx.fillStyle = c.body;
  ctx.beginPath();
  ctx.ellipse(0, 0, 46, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.glass;
  ctx.beginPath();
  ctx.ellipse(22, -4, 22, 15, 0, -Math.PI / 2, Math.PI / 2 - 0.3);
  ctx.lineTo(14, 8);
  ctx.lineTo(14, -19);
  ctx.fill();

  // Mast
  ctx.fillStyle = c.metal;
  ctx.fillRect(-3, -30, 6, 10);

  // Huvudrotor från sidan: 4 blad på en svagt lutad skiva
  const L = 100;
  ctx.save();
  ctx.translate(0, -31);
  if (blur > 0.05) {
    ctx.globalAlpha = 0.35 * blur;
    ctx.fillStyle = c.rotor;
    ctx.beginPath();
    ctx.ellipse(0, 0, L, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1 - 0.7 * blur;
  ctx.strokeStyle = c.rotor;
  ctx.lineWidth = 4;
  for (let k = 0; k < 4; k++) {
    const phi = rotor.angle + (k * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(phi) * L, Math.sin(phi) * 7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.metal;
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawCloud(ctx, x, y, s) {
  ctx.beginPath();
  ctx.ellipse(x, y, 34 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 26 * s, y + 4 * s, 26 * s, 11 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 24 * s, y + 5 * s, 22 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawTree(ctx, x, groundY, c) {
  ctx.fillStyle = c.trunk;
  ctx.fillRect(x - 2, groundY - 12, 4, 12);
  ctx.fillStyle = c.tree;
  ctx.beginPath();
  ctx.moveTo(x, groundY - 38);
  ctx.lineTo(x + 11, groundY - 10);
  ctx.lineTo(x - 11, groundY - 10);
  ctx.fill();
}
