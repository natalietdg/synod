/* ============================================================
   SYNOD — "The Council" generative hero graphic
   Five lens-nodes (each its doctrine hue) fire filament beams inward
   to a gold Arbiter, which periodically resolves them into a single
   vertical verdict stroke. Canvas 2D, DPR-aware, reduced-motion safe.

   Usage:  <div class="council" data-council></div>
   Options via data-attrs:
     data-labels   -> draw monospace lens labels (default on)
     data-quiet    -> dimmer (for use as a backdrop behind text)
   ============================================================ */
(function () {
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var LENSES = [
    { name: 'TRUST',    q: 'why',     color: [155, 127, 212] },
    { name: 'PRESSURE', q: 'leverage',color: [214, 138, 74]  },
    { name: 'FRAME',    q: 'game',    color: [201, 106, 166] },
    { name: 'PROBE',    q: 'learn',   color: [91, 155, 214]  },
    { name: 'HEDGE',    q: 'if-wrong',color: [207, 98, 88]   }
  ];
  var GOLD = [201, 164, 76];

  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  function Council(host) {
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    host.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var quiet = host.hasAttribute('data-quiet');
    var showLabels = host.getAttribute('data-labels') !== 'off';

    var W = 0, H = 0, DPR = 1, cx = 0, cy = 0, rad = 0;
    var dust = [];       // background drift field
    var beams = [];      // traveling pulses per lens
    var t0 = performance.now();

    function resize() {
      var r = host.getBoundingClientRect();
      var w = Math.max(2, r.width), h = Math.max(2, r.height);
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      if (w === W && h === H && dpr === DPR) return false;   // unchanged: don't clear
      W = w; H = h; DPR = dpr;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W / 2; cy = H * 0.5;
      rad = Math.min(W, H) * 0.36;
      seedDust();
      return true;
    }

    function seedDust() {
      dust = [];
      var n = Math.round((W * H) / 9000);
      n = Math.max(40, Math.min(220, n));
      for (var i = 0; i < n; i++) {
        dust.push({
          x: Math.random() * W, y: Math.random() * H,
          r: Math.random() * 1.2 + 0.3,
          a: Math.random() * 0.5 + 0.1,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.12,
          ph: Math.random() * Math.PI * 2
        });
      }
    }

    function nodePos(i, time) {
      var spin = time * 0.000035;           // very slow rotation
      var ang = -Math.PI / 2 + i * (Math.PI * 2 / 5) + spin;
      var wob = Math.sin(time * 0.0006 + i * 1.7) * (rad * 0.018);
      return { x: cx + Math.cos(ang) * (rad + wob), y: cy + Math.sin(ang) * (rad + wob), ang: ang };
    }

    // periodic verdict cadence
    function verdictPhase(time) {
      var period = 6200;
      var p = (time % period) / period;     // 0..1
      return p;
    }

    function draw(now) {
      var time = now - t0;
      ctx.clearRect(0, 0, W, H);

      var dim = quiet ? 0.55 : 1;

      // ---- background dust ----
      for (var i = 0; i < dust.length; i++) {
        var d = dust[i];
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0) d.x += W; if (d.x > W) d.x -= W;
        if (d.y < 0) d.y += H; if (d.y > H) d.y -= H;
        var tw = 0.55 + 0.45 * Math.sin(time * 0.001 + d.ph);
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = rgba([216, 203, 176], d.a * tw * 0.18 * dim);
        ctx.fill();
      }

      // ---- forensic guide rings ----
      ctx.lineWidth = 1;
      for (var g = 0; g < 2; g++) {
        ctx.beginPath();
        ctx.arc(cx, cy, rad * (0.42 + g * 0.62), 0, Math.PI * 2);
        ctx.strokeStyle = rgba([216, 203, 176], 0.04 * dim);
        ctx.stroke();
      }

      var nodes = [];
      for (var n = 0; n < 5; n++) nodes.push(nodePos(n, time));

      var vp = verdictPhase(time);
      // resolve window: beams intensify near end of phase
      var resolve = Math.max(0, (vp - 0.62) / 0.38);   // 0..1 ramp in last part
      var settled = vp < 0.18 ? (1 - vp / 0.18) : 0;    // afterglow at start

      // ---- pentagon ring (council in session) ----
      ctx.beginPath();
      for (var p = 0; p <= 5; p++) {
        var nn = nodes[p % 5];
        if (p === 0) ctx.moveTo(nn.x, nn.y); else ctx.lineTo(nn.x, nn.y);
      }
      ctx.strokeStyle = rgba([216, 203, 176], (0.07 + resolve * 0.05) * dim);
      ctx.lineWidth = 1;
      ctx.stroke();

      // faint full graph (every pair) — adds depth
      ctx.lineWidth = 1;
      for (var a1 = 0; a1 < 5; a1++) for (var b1 = a1 + 1; b1 < 5; b1++) {
        ctx.beginPath();
        ctx.moveTo(nodes[a1].x, nodes[a1].y);
        ctx.lineTo(nodes[b1].x, nodes[b1].y);
        ctx.strokeStyle = rgba([216, 203, 176], 0.022 * dim);
        ctx.stroke();
      }

      // ---- beams: each lens -> arbiter ----
      for (var k = 0; k < 5; k++) {
        var node = nodes[k]; var col = LENSES[k].color;
        var grad = ctx.createLinearGradient(node.x, node.y, cx, cy);
        var baseA = (0.10 + resolve * 0.34) * dim;
        grad.addColorStop(0, rgba(col, baseA * 0.2));
        grad.addColorStop(0.5, rgba(col, baseA));
        grad.addColorStop(1, rgba(GOLD, (0.05 + resolve * 0.3) * dim));
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(cx, cy);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1 + resolve * 1.4;
        ctx.stroke();

        // traveling pulse along beam
        var pulseT = ((time * 0.00045) + k * 0.21) % 1;
        var px = node.x + (cx - node.x) * pulseT;
        var py = node.y + (cy - node.y) * pulseT;
        var pr = 2.4 * (1 - pulseT * 0.4);
        var pg = ctx.createRadialGradient(px, py, 0, px, py, pr * 4);
        pg.addColorStop(0, rgba(col, 0.9 * dim));
        pg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(px, py, pr * 4, 0, Math.PI * 2); ctx.fill();
      }

      // ---- lens nodes ----
      for (var m = 0; m < 5; m++) {
        var nd = nodes[m]; var c = LENSES[m].color;
        var pulse = 0.5 + 0.5 * Math.sin(time * 0.0014 + m * 1.3);
        var coreR = 4.6 + pulse * 1.8;
        var glowR = 26 + pulse * 10;
        var gg = ctx.createRadialGradient(nd.x, nd.y, 0, nd.x, nd.y, glowR);
        gg.addColorStop(0, rgba(c, 0.55 * dim));
        gg.addColorStop(0.4, rgba(c, 0.16 * dim));
        gg.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(nd.x, nd.y, glowR, 0, Math.PI * 2); ctx.fill();

        ctx.beginPath(); ctx.arc(nd.x, nd.y, coreR, 0, Math.PI * 2);
        ctx.fillStyle = rgba([245, 240, 228], 0.95 * dim); ctx.fill();
        ctx.beginPath(); ctx.arc(nd.x, nd.y, coreR + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(c, 0.85 * dim); ctx.lineWidth = 1.4; ctx.stroke();

        if (showLabels && !quiet) {
          var lx = cx + (nd.x - cx) * 1.22;
          var ly = cy + (nd.y - cy) * 1.22;
          ctx.font = '600 10px "IBM Plex Mono", monospace';
          ctx.textAlign = lx < cx - 4 ? 'right' : (lx > cx + 4 ? 'left' : 'center');
          ctx.textBaseline = 'middle';
          ctx.fillStyle = rgba(c, 0.92);
          ctx.fillText(LENSES[m].name, lx, ly - 6);
          ctx.font = '400 9px "IBM Plex Mono", monospace';
          ctx.fillStyle = rgba([216, 203, 176], 0.4);
          ctx.fillText(LENSES[m].q, lx, ly + 6);
        }
      }

      // ---- arbiter core ----
      var charge = Math.max(resolve, settled);
      var coreGlow = 30 + charge * 46;
      var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreGlow);
      cg.addColorStop(0, rgba(GOLD, (0.7 + charge * 0.3) * dim));
      cg.addColorStop(0.35, rgba(GOLD, 0.28 * dim));
      cg.addColorStop(1, rgba(GOLD, 0));
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(cx, cy, coreGlow, 0, Math.PI * 2); ctx.fill();

      // verdict stroke — vertical needle that flares as judgment resolves
      var needleH = rad * (0.34 + charge * 0.5);
      var ng = ctx.createLinearGradient(cx, cy - needleH, cx, cy + needleH);
      ng.addColorStop(0, rgba(GOLD, 0));
      ng.addColorStop(0.5, rgba(GOLD, (0.5 + charge * 0.5) * dim));
      ng.addColorStop(1, rgba(GOLD, 0));
      ctx.strokeStyle = ng; ctx.lineWidth = 1.6 + charge * 1.6;
      ctx.beginPath(); ctx.moveTo(cx, cy - needleH); ctx.lineTo(cx, cy + needleH); ctx.stroke();

      ctx.beginPath(); ctx.arc(cx, cy, 3 + charge * 2.4, 0, Math.PI * 2);
      ctx.fillStyle = rgba([255, 248, 232], (0.9) * dim); ctx.fill();

      // verdict ring expands at the resolve climax
      if (resolve > 0.001) {
        var rr = resolve * rad * 1.1;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(GOLD, (1 - resolve) * 0.5 * dim);
        ctx.lineWidth = 1.2; ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    }

    var raf = null;
    function startLoop() { if (!raf) raf = requestAnimationFrame(draw); }

    // expose for testing in throttled/background iframes
    host.__councilDraw = function (rel) { resize(); draw(t0 + rel); if (raf) { cancelAnimationFrame(raf); raf = null; } };

    resize();
    if (REDUCE) {
      // draw a single resolved frame
      t0 = performance.now() - 6200 * 0.85;
      draw(performance.now());
      cancelAnimationFrame(raf); raf = null;
    } else {
      // paint one frame synchronously (so it's never blank even if rAF is
      // throttled), then let draw()'s own rAF chain carry the animation.
      draw(performance.now());
    }

    var ro = new ResizeObserver(function () {
      // repaint after a genuine size change if the rAF loop isn't carrying it
      if (resize() && !raf) draw(performance.now());
    });
    ro.observe(host);

    // pause only when the tab is actually hidden (reliable; never blanks a
    // visible-but-iframed canvas the way IntersectionObserver can).
    if (!REDUCE) {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
        else startLoop();
      });
    }
  }

  function init() {
    document.querySelectorAll('[data-council]').forEach(function (el) {
      if (el.__council) return; el.__council = true; new Council(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
