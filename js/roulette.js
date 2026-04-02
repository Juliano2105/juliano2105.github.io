/**
 * ROLETA VIRTUAL - Motor de animação
 * Toda a decisão do prêmio vem do BACKEND.
 * O frontend apenas anima até o índice informado.
 */
class Roulette {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.segments = [];
    this.currentAngle = 0;
    this.isSpinning = false;
    this.onSpinEnd = options.onSpinEnd || null;
    this.size = options.size || 320;
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.cx = this.size / 2;
    this.cy = this.size / 2;
    this.radius = this.size / 2 - 8;
    this.textRadius = this.radius * 0.65;
    this.rafId = null;
    this._draw();
  }

  setSegments(segments) {
    this.segments = segments;
    this._draw();
  }

  _draw() {
    const ctx = this.ctx;
    const n = this.segments.length;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (n === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, this.radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const arc = (Math.PI * 2) / n;
    this.segments.forEach((seg, i) => {
      const startAngle = this.currentAngle + arc * i - Math.PI / 2;
      const endAngle = startAngle + arc;
      // Segmento
      ctx.beginPath();
      ctx.moveTo(this.cx, this.cy);
      ctx.arc(this.cx, this.cy, this.radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = seg.color || this._defaultColor(i);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Texto
      const midAngle = startAngle + arc / 2;
      ctx.save();
      ctx.translate(
        this.cx + Math.cos(midAngle) * this.textRadius,
        this.cy + Math.sin(midAngle) * this.textRadius
      );
      ctx.rotate(midAngle + Math.PI / 2);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${this._fontSize(seg.label)}px 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      // Quebra texto longo
      const lines = this._wrapText(seg.label, 9);
      lines.forEach((line, li) => {
        ctx.fillText(line, 0, (li - (lines.length - 1) / 2) * (this._fontSize(seg.label) + 2));
      });
      ctx.restore();
    });
    // Borda externa
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Centro
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, 22, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, 22);
    grad.addColorStop(0, '#FFD700');
    grad.addColorStop(1, '#FF6B35');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Estrela no centro
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', this.cx, this.cy);
  }

  _fontSize(label) {
    if (!label) return 12;
    if (label.length <= 8) return 14;
    if (label.length <= 14) return 12;
    return 10;
  }

  _wrapText(text, maxLen) {
    if (!text || text.length <= maxLen) return [text || ''];
    const words = text.split(' ');
    const lines = [];
    let current = '';
    words.forEach(word => {
      if ((current + ' ' + word).trim().length <= maxLen) {
        current = (current + ' ' + word).trim();
      } else {
        if (current) lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);
    return lines.length ? lines : [text.substring(0, maxLen)];
  }

  _defaultColor(i) {
    const colors = [
      '#6C3FC5','#FF6B35','#FFD700','#2ECC71','#E74C3C',
      '#3498DB','#9B59B6','#1ABC9C','#F39C12','#E91E63',
      '#00BCD4','#8BC34A'
    ];
    return colors[i % colors.length];
  }

  /**
   * Gira a roleta até o índice alvo (decidido pelo backend)
   * @param {number} targetIndex - Índice do segmento vencedor
   * @param {function} callback - Chamado ao terminar
   */
  spinToIndex(targetIndex, callback) {
    if (this.isSpinning) return;
    if (this.segments.length === 0) return;
    this.isSpinning = true;

    const n = this.segments.length;
    const arc = (Math.PI * 2) / n;

    // Calcula ângulo alvo: o segmento targetIndex deve parar na posição do ponteiro (topo = -PI/2)
    // Adiciona voltas extras (entre 5 e 8) para dar dramaturgia
    const extraSpins = (5 + Math.floor(Math.random() * 3)) * Math.PI * 2;
    // Posição alvo: o meio do segmento targetIndex deve ficar em -PI/2 (ponteiro)
    const targetMid = arc * targetIndex + arc / 2;
    const targetAngle = -targetMid + Math.PI / 2 + extraSpins;

    const startAngle = this.currentAngle;
    const totalRotation = targetAngle - startAngle;
    const duration = 4000 + Math.random() * 1500; // 4–5.5 segundos
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Easing: easeInOutQuart com desaceleração final
      const eased = this._easeInOutQuart(progress);
      this.currentAngle = startAngle + totalRotation * eased;
      this._draw();
      if (progress < 1) {
        this.rafId = requestAnimationFrame(animate);
      } else {
        this.currentAngle = startAngle + totalRotation;
        this._draw();
        this.isSpinning = false;
        if (callback) callback(targetIndex);
        if (this.onSpinEnd) this.onSpinEnd(targetIndex);
      }
    };
    this.rafId = requestAnimationFrame(animate);
  }

  _easeInOutQuart(t) {
    return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
  }

  stopSpin() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.isSpinning = false;
  }

  reset() {
    this.stopSpin();
    this.currentAngle = 0;
    this._draw();
  }
}

// Efeito de confetes ao ganhar um prêmio
function launchConfetti(count = 80) {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);
  const colors = ['#6C3FC5','#FF6B35','#FFD700','#2ECC71','#E74C3C','#3498DB','#fff'];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const size = 6 + Math.random() * 8;
    piece.style.cssText = `
      left: ${Math.random() * 100}%;
      width: ${size}px;
      height: ${size}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      animation-duration: ${1.5 + Math.random() * 2}s;
      animation-delay: ${Math.random() * 0.5}s;
      transform: rotate(${Math.random() * 360}deg);
    `;
    container.appendChild(piece);
  }
  setTimeout(() => container.remove(), 4000);
}

window.Roulette = Roulette;
window.launchConfetti = launchConfetti;
