const fs = require('fs');

const file = 'public/game.js';
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Find start and end of drawAstralArchon
let startIdx = -1;
let endIdx = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('function drawAstralArchon(ctx,')) {
    // line before might be comment
    startIdx = i > 0 && lines[i-1].includes('MÄGIC') ? i - 1 : i;
    break;
  }
}

if (startIdx === -1) {
  console.error('Could not find drawAstralArchon start');
  process.exit(1);
}

for (let i = startIdx; i < lines.length; i++) {
  if (lines[i] === '  }' && lines[i+2] && lines[i+2].includes('function drawCharacter()')) {
    endIdx = i;
    break;
  }
}

if (endIdx === -1) {
  console.error('Could not find drawAstralArchon end');
  process.exit(1);
}

console.log(`Found drawAstralArchon from line ${startIdx + 1} to ${endIdx + 1}`);

const newCode = `  // --- MERGE TOWER MASCOTS (4 ICONIC BRAND ARCHETYPES) ---
  function drawMascotCharacter(ctx, {
    mascot = currentMascot || 'lumi',
    cx = 0,
    cy = 0,
    scale = 1.0,
    tilt = 0,
    flipProgress = 0,
    now = performance.now(),
    house = currentHouse || 'chrono',
    skin = equippedSkin || 'default',
    lookX = 0,
    lookY = 0,
    aiming = false,
    happy = false,
    worried = false,
    ballColor = '#4deeea'
  }) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    if (flipProgress > 0) {
      const flipAngle = (1 - flipProgress) * Math.PI * 2;
      ctx.rotate(flipAngle);
    } else {
      ctx.rotate(tilt);
    }

    // Color palette based on Great House and Skin
    let primaryColor = '#1d4ed8'; // Royal Sapphire
    let glowColor = '#38bdf8';    // Bright Cyan
    let accentColor = '#ffd23f';  // Celestial Gold
    let darkColor = '#060a1c';

    if (house === 'singularity') {
      primaryColor = '#6b21a8';
      glowColor = '#e879f9';
      accentColor = '#f43f5e';
      darkColor = '#090314';
    } else if (house === 'pulsar') {
      primaryColor = '#c2410c';
      glowColor = '#fbbf24';
      accentColor = '#ffd23f';
      darkColor = '#140502';
    } else if (house === 'nebula') {
      primaryColor = '#047857';
      glowColor = '#34d399';
      accentColor = '#a7f3d0';
      darkColor = '#02120e';
    }

    if (skin === 'gold') {
      primaryColor = '#b45309';
      glowColor = '#fde047';
      accentColor = '#ffd23f';
    } else if (skin === 'shadow') {
      primaryColor = '#3b0764';
      glowColor = '#c084fc';
      accentColor = '#a855f7';
    } else if (skin === 'rainbow') {
      const hue = (now * 0.05) % 360;
      primaryColor = \`hsl(\${hue}, 85%, 45%)\`;
      glowColor = \`hsl(\${(hue + 60) % 360}, 100%, 65%)\`;
      accentColor = \`hsl(\${(hue + 120) % 360}, 100%, 70%)\`;
    }

    // =========================================================================
    // VARIANT 1: LUMI — АСТРАЛЬНЫЙ ЗВЁЗДНЫЙ ДУХ (Ethereal Cosmic Wisp)
    // =========================================================================
    if (mascot === 'lumi') {
      // Soft breathing aura disc
      const haloR = 24 + Math.sin(now * 0.003) * 2;
      const hGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, haloR);
      hGrad.addColorStop(0, glowColor);
      hGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.25)');
      hGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = hGrad;
      ctx.beginPath();
      ctx.arc(0, 0, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Fluid comet spirit tail waving
      const tailWave = Math.sin(now * 0.005) * 4;
      ctx.beginPath();
      ctx.moveTo(-16, -2);
      ctx.bezierCurveTo(-15, 12, -7 + tailWave, 22, tailWave * 1.4, 28);
      ctx.bezierCurveTo(7 + tailWave, 22, 15, 12, 16, -2);
      ctx.arc(0, -2, 16, 0, Math.PI, true);
      ctx.closePath();

      const bodyGrad = ctx.createRadialGradient(-4, -6, 2, 0, 4, 22);
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.32, glowColor);
      bodyGrad.addColorStop(0.75, primaryColor);
      bodyGrad.addColorStop(1, darkColor);
      ctx.fillStyle = bodyGrad;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = accentColor;
      ctx.stroke();

      // Two elegant spirit tendril antennae
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(s * 6, -15);
        ctx.quadraticCurveTo(s * 15, -26, s * 9, -30);
        ctx.quadraticCurveTo(s * 5, -22, s * 2, -16);
        ctx.fillStyle = glowColor;
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.0;
        ctx.stroke();
        ctx.restore();
      }

      // Floating 4-pointed Star Crown
      const starY = -28 + Math.sin(now * 0.004) * 2;
      drawMiniStar(ctx, 0, starY, 4.5, '#ffd23f');

      // Galaxy Star Eyes
      for (const s of [-1, 1]) {
        const ex = s * 6.5;
        const ey = -3;
        if (happy) {
          ctx.beginPath();
          ctx.arc(ex, ey + 1, 4.2, Math.PI * 1.1, Math.PI * 1.9);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.2;
          ctx.lineCap = 'round';
          ctx.stroke();
        } else if (worried) {
          ctx.beginPath();
          ctx.ellipse(ex + lookX * 0.25, ey + lookY * 0.25, 4.4, 5.5, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#030712';
          ctx.fill();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ex + lookX * 0.35, ey + lookY * 0.35, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.ellipse(ex + lookX * 0.3, ey + lookY * 0.3, 4.2, 5.2, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#050a1c';
          ctx.fill();
          ctx.strokeStyle = glowColor;
          ctx.lineWidth = 1.0;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(ex + lookX * 0.3, ey + lookY * 0.3 + 1, 2.6, 0.2 * Math.PI, 0.8 * Math.PI);
          ctx.strokeStyle = glowColor;
          ctx.lineWidth = 1.6;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(ex + lookX * 0.4 + 1.2, ey + lookY * 0.4 - 1.3, 1.4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }

        // Glowing cheeks
        ctx.beginPath();
        ctx.ellipse(s * 10, 4.5, 3.2, 1.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 120, 180, 0.55)';
        ctx.fill();
      }

      // Cute smile
      ctx.beginPath();
      ctx.arc(0, 3.2, 3.6, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Floating droplet hands
      for (const s of [-1, 1]) {
        const hx = s * 20;
        const hy = 4 + Math.sin(now * 0.004 + s) * 2.5;
        ctx.beginPath();
        ctx.ellipse(hx, hy, 4, 3, s * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }

      // Orbiting stardust motes
      for (let m = 0; m < 2; m++) {
        const theta = (now * 0.0025) + (m * Math.PI);
        const ox = Math.cos(theta) * 26;
        const oy = Math.sin(theta) * 8 + 4;
        drawMiniStar(ctx, ox, oy, 2.5, m === 0 ? '#ffd23f' : '#4deeea');
      }
    }

    // =========================================================================
    // VARIANT 2: NOVA — АСТРО-БОТ / КИБЕР-ФАМИЛЬЯР (Sleek Sci-Fi Droid)
    // =========================================================================
    else if (mascot === 'bot') {
      // Repulsor energy base
      ctx.beginPath();
      ctx.ellipse(0, 20, 15, 4.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 12, 34, 0.85)';
      ctx.fill();
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Porcelain ceramic capsule shell
      ctx.beginPath();
      ctx.roundRect(-16, -18, 32, 36, 16);
      const botGrad = ctx.createLinearGradient(-16, -18, 16, 18);
      botGrad.addColorStop(0, '#ffffff');
      botGrad.addColorStop(0.45, '#e2e8f0');
      botGrad.addColorStop(0.85, '#94a3b8');
      botGrad.addColorStop(1, '#334155');
      ctx.fillStyle = botGrad;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Aerodynamic ear-sensor pylons
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(s * 17 - (s > 0 ? 0 : 4), -14, 4, 12, 2);
        ctx.fillStyle = '#1e293b';
        ctx.fill();
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 1.0;
        ctx.stroke();
        // Power slit
        ctx.beginPath();
        ctx.arc(s * 18, -8, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = ballColor;
        ctx.shadowColor = ballColor;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Curved Obsidian Visor
      ctx.beginPath();
      ctx.roundRect(-12, -12, 24, 16, 8);
      ctx.fillStyle = '#030712';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // Glass specular reflection arc
      ctx.beginPath();
      ctx.ellipse(-3, -9, 7, 2.4, -0.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fill();

      // LED Eyes on Visor
      for (const s of [-1, 1]) {
        const ex = s * 5.5 + lookX * 0.3;
        const ey = -4.5 + lookY * 0.3;
        if (happy) {
          ctx.beginPath();
          ctx.arc(ex, ey, 3.2, Math.PI * 1.1, Math.PI * 1.9);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.0;
          ctx.lineCap = 'round';
          ctx.stroke();
        } else if (aiming) {
          // Precision crosshair pupil
          ctx.beginPath();
          ctx.arc(ex, ey, 3.0, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffd23f';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ex, ey, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = '#ffd23f';
          ctx.fill();
        } else if (worried) {
          ctx.beginPath();
          ctx.moveTo(ex - 2.5, ey);
          ctx.lineTo(ex, ey - 2);
          ctx.lineTo(ex + 2.5, ey);
          ctx.strokeStyle = '#f43f5e';
          ctx.lineWidth = 1.8;
          ctx.lineCap = 'round';
          ctx.stroke();
        } else {
          // Digital pill LED eyes
          ctx.beginPath();
          ctx.roundRect(ex - 2.2, ey - 3.2, 4.4, 6.4, 2.2);
          ctx.fillStyle = '#38bdf8';
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(ex, ey - 1, 1.1, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }

      // Magnetic floating hands
      for (const s of [-1, 1]) {
        const hx = s * 21;
        const hy = 3 + Math.sin(now * 0.005 + s) * 2;
        ctx.beginPath();
        ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#334155';
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.fill();
      }
    }

    // =========================================================================
    // VARIANT 3: AETHER — ЗВЁЗДНЫЙ ДРАКОНЧИК (Celestial Star Drake)
    // =========================================================================
    else if (mascot === 'dragon') {
      // Fluttering Constellation Wings
      const flap = Math.sin(now * 0.015) * 0.26;
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(s * 10, -2);
        ctx.scale(s, 1 + flap);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(10, -18, 22, -14, 25, -6);
        ctx.bezierCurveTo(22, 0, 16, 6, 0, 4);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // Wing star constellation nodes
        ctx.beginPath();
        ctx.arc(16, -10, 1.4, 0, Math.PI * 2);
        ctx.arc(22, -5, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd23f';
        ctx.fill();
        ctx.restore();
      }

      // Wiggling Star Tail
      const tailS = Math.sin(now * 0.008) * 3.5;
      ctx.beginPath();
      ctx.moveTo(8, 14);
      ctx.bezierCurveTo(18, 16, 22 + tailS, 8, 21 + tailS * 1.2, 2);
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 4.0;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = accentColor;
      ctx.stroke();
      drawMiniStar(ctx, 22 + tailS * 1.2, 2, 4.2, '#ffd23f');

      // Dragon Body
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      const dragGrad = ctx.createRadialGradient(-4, -6, 2, 0, 0, 18);
      dragGrad.addColorStop(0, '#ffffff');
      dragGrad.addColorStop(0.3, glowColor);
      dragGrad.addColorStop(0.75, primaryColor);
      dragGrad.addColorStop(1, darkColor);
      ctx.fillStyle = dragGrad;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Soft Golden Belly Plate
      ctx.beginPath();
      ctx.ellipse(0, 7, 9, 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(254, 240, 138, 0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 210, 63, 0.6)';
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // Faceted Crystalline Horns
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 5, -14);
        ctx.lineTo(s * 15, -28);
        ctx.lineTo(s * 10, -28);
        ctx.lineTo(s * 2, -16);
        ctx.closePath();
        ctx.fillStyle = accentColor;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }

      // Dragon Eyes
      for (const s of [-1, 1]) {
        const ex = s * 6.5;
        const ey = -2.5;
        if (happy) {
          ctx.beginPath();
          ctx.arc(ex, ey + 1, 4.2, Math.PI * 1.1, Math.PI * 1.9);
          ctx.strokeStyle = '#ffd23f';
          ctx.lineWidth = 2.2;
          ctx.lineCap = 'round';
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.ellipse(ex + lookX * 0.3, ey + lookY * 0.3, 4.4, 5.2, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#ffd23f';
          ctx.fill();
          ctx.strokeStyle = '#78350f';
          ctx.lineWidth = 1.0;
          ctx.stroke();
          // Vertical slit pupil
          ctx.beginPath();
          ctx.ellipse(ex + lookX * 0.35, ey + lookY * 0.35, aiming ? 1.0 : 1.8, 4.2, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#050a1c';
          ctx.fill();
          // Specular glint
          ctx.beginPath();
          ctx.arc(ex + lookX * 0.4 + 1.2, ey + lookY * 0.4 - 1.4, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }

      // Snout with tiny tooth
      ctx.beginPath();
      ctx.arc(0, 4, 3.5, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Tiny white tooth
      ctx.beginPath();
      ctx.moveTo(1.5, 5.0);
      ctx.lineTo(2.8, 6.8);
      ctx.lineTo(3.8, 5.0);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Floating cute paws
      for (const s of [-1, 1]) {
        const px = s * 19;
        const py = 6 + Math.sin(now * 0.005 + s) * 2;
        ctx.beginPath();
        ctx.ellipse(px, py, 4, 3, s * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = primaryColor;
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }
    }

    // =========================================================================
    // VARIANT 4: ORION — ЗВЁЗДНЫЙ РЫЦАРЬ (The Celestial Wanderer)
    // =========================================================================
    else if (mascot === 'knight') {
      // Flowing Cosmic Silk Scarf
      const wave1 = Math.sin(now * 0.006) * 4;
      const wave2 = Math.sin(now * 0.006 + 1) * 6;
      ctx.beginPath();
      ctx.moveTo(-8, 8);
      ctx.bezierCurveTo(-18, 12, -24 + wave1, 16, -30 + wave2, 22);
      ctx.lineTo(-24 + wave2, 25);
      ctx.bezierCurveTo(-18 + wave1, 18, -10, 14, -3, 10);
      ctx.closePath();
      const scarfGrad = ctx.createLinearGradient(-8, 8, -30, 24);
      scarfGrad.addColorStop(0, accentColor);
      scarfGrad.addColorStop(1, glowColor);
      ctx.fillStyle = scarfGrad;
      ctx.shadowColor = accentColor;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Porcelain Star Mask with Crescent Crests
      ctx.beginPath();
      ctx.moveTo(-14, 2);
      ctx.bezierCurveTo(-15, -12, -10, -22, -12, -31); // Left crest
      ctx.quadraticCurveTo(-7, -24, -4, -17);
      ctx.lineTo(0, -19); // Center dip
      ctx.lineTo(4, -17);
      ctx.quadraticCurveTo(7, -24, 12, -31); // Right crest
      ctx.bezierCurveTo(10, -22, 15, -12, 14, 2);
      ctx.bezierCurveTo(12, 14, -12, 14, -14, 2);
      ctx.closePath();

      const maskGrad = ctx.createRadialGradient(-3, -8, 2, 0, 0, 22);
      maskGrad.addColorStop(0, '#ffffff');
      maskGrad.addColorStop(0.5, '#f1f5f9');
      maskGrad.addColorStop(0.85, '#cbd5e1');
      maskGrad.addColorStop(1, '#334155');
      ctx.fillStyle = maskGrad;
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = '#1e293b';
      ctx.stroke();

      // Forehead Citadel Star
      drawMiniStar(ctx, 0, -11, 3.2, '#ffd23f');

      // Deep Void Eyes with Starlight Pupils
      for (const s of [-1, 1]) {
        const ex = s * 6.5;
        const ey = -2.5;
        ctx.beginPath();
        ctx.ellipse(ex + lookX * 0.3, ey + lookY * 0.3, 3.8, 5.0, s * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = '#050a1c';
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.0;
        ctx.stroke();

        // Piercing Starlight pupil
        ctx.beginPath();
        ctx.arc(ex + lookX * 0.4, ey + lookY * 0.4, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Midnight Mantle with Golden Medallion
      ctx.beginPath();
      ctx.ellipse(0, 14, 11, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0f24';
      ctx.fill();
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Floating Plated Gauntlets
      for (const s of [-1, 1]) {
        const gx = s * 21;
        const gy = 5 + Math.sin(now * 0.005 + s) * 2;
        ctx.beginPath();
        ctx.roundRect(gx - 3.5, gy - 4.5, 7, 9, 3);
        ctx.fillStyle = '#1e293b';
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // Palm gem
        ctx.beginPath();
        ctx.arc(gx, gy, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.fill();
      }
    }

    ctx.restore();
  }
  const drawAstralArchon = drawMascotCharacter;`;

lines.splice(startIdx, (endIdx - startIdx + 1), newCode);

fs.writeFileSync(file, lines.join('\n'), 'utf8');
console.log('Successfully updated mascot renderer in public/game.js');
