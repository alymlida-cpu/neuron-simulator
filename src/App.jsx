import { useState, useEffect, useRef, useCallback } from "react";

const MEMBRANE_LENGTH = 80;
const RESTING_POTENTIAL = -70;
const THRESHOLD = -55;
const PEAK = 40;
const REFRACTORY = -80;

function initNodes() {
  return Array.from({ length: MEMBRANE_LENGTH }, (_, i) => ({
    id: i,
    voltage: RESTING_POTENTIAL,
    phase: "rest", // rest | rising | falling | refractory
    timer: 0,
  }));
}

function useAnimationFrame(callback, running) {
  const rafRef = useRef(null);
  const lastRef = useRef(null);
  useEffect(() => {
    if (!running) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const loop = (ts) => {
      const dt = lastRef.current ? Math.min((ts - lastRef.current) / 1000, 0.05) : 0.016;
      lastRef.current = ts;
      callback(dt);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, callback]);
}

const PHASE_DURATION = { rising: 0.5, falling: 0.8, refractory: 1.2 };

function voltageColor(v) {
  const t = (v - RESTING_POTENTIAL) / (PEAK - RESTING_POTENTIAL);
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.5) {
    const s = clamped * 2;
    return `rgb(${Math.round(30 + s * 60)}, ${Math.round(180 - s * 100)}, ${Math.round(255 - s * 100)})`;
  } else {
    const s = (clamped - 0.5) * 2;
    return `rgb(${Math.round(90 + s * 165)}, ${Math.round(80 - s * 60)}, ${Math.round(155 - s * 140)})`;
  }
}

function IonChannel({ open, ion, x, y }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x="-8" y="-18" width="16" height="36" rx="4"
        fill={open ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.3)"}
        stroke={open ? "#7efff5" : "#334"}
        strokeWidth="1.5" />
      {open ? (
        <>
          <rect x="-5" y="-18" width="10" height="14" rx="2" fill={ion === "Na" ? "#ff9f43" : "#54a0ff"} opacity="0.9" />
          <rect x="-5" y="4" width="10" height="14" rx="2" fill={ion === "Na" ? "#ff9f43" : "#54a0ff"} opacity="0.9" />
          <text x="0" y="-5" textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">{ion}⁺</text>
        </>
      ) : (
        <>
          <rect x="-5" y="-18" width="10" height="36" rx="2" fill="#223" opacity="0.7" />
          <text x="0" y="3" textAnchor="middle" fontSize="7" fill="#556" fontWeight="bold">{ion}⁺</text>
        </>
      )}
    </g>
  );
}

export default function NeuronSimulator() {
  const [nodes, setNodes] = useState(initNodes);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [history, setHistory] = useState([Array(MEMBRANE_LENGTH).fill(RESTING_POTENTIAL)]);
  const [stimCount, setStimCount] = useState(0);
  const nodesRef = useRef(nodes);
  const histRef = useRef(history);
  const speedRef = useRef(speed);
  const graphCanvasRef = useRef(null);
  const tickRef = useRef(0);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { histRef.current = history; }, [history]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const stimulate = useCallback(() => {
    setNodes(prev => {
      const next = [...prev];
      if (next[0].phase === "rest") {
        next[0] = { ...next[0], phase: "rising", timer: 0 };
      }
      return next;
    });
    setStimCount(c => c + 1);
    setRunning(true);
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    setNodes(initNodes());
    setHistory([Array(MEMBRANE_LENGTH).fill(RESTING_POTENTIAL)]);
    setStimCount(0);
    tickRef.current = 0;
  }, []);

  const step = useCallback((dt) => {
    const s = speedRef.current;
    const eff = dt * s;
    setNodes(prev => {
      const cur = prev.map(n => ({ ...n }));
      for (let i = 0; i < cur.length; i++) {
        const n = cur[i];
        n.timer += eff;
        if (n.phase === "rising") {
          const progress = Math.min(n.timer / PHASE_DURATION.rising, 1);
          n.voltage = RESTING_POTENTIAL + (PEAK - RESTING_POTENTIAL) * Math.sin(progress * Math.PI / 2);
          if (n.timer >= PHASE_DURATION.rising) { n.phase = "falling"; n.timer = 0; }
          // propagate
          if (i + 1 < cur.length && cur[i + 1].phase === "rest" && progress > 0.3) {
            cur[i + 1] = { ...cur[i + 1], phase: "rising", timer: 0 };
          }
        } else if (n.phase === "falling") {
          const progress = Math.min(n.timer / PHASE_DURATION.falling, 1);
          n.voltage = PEAK + (REFRACTORY - PEAK) * Math.sin(progress * Math.PI / 2);
          if (n.timer >= PHASE_DURATION.falling) { n.phase = "refractory"; n.timer = 0; }
        } else if (n.phase === "refractory") {
          const progress = Math.min(n.timer / PHASE_DURATION.refractory, 1);
          n.voltage = REFRACTORY + (RESTING_POTENTIAL - REFRACTORY) * progress;
          if (n.timer >= PHASE_DURATION.refractory) { n.phase = "rest"; n.voltage = RESTING_POTENTIAL; }
        }
      }
      // stop if all at rest
      const anyActive = cur.some(n => n.phase !== "rest");
      if (!anyActive) setRunning(false);
      return cur;
    });

    tickRef.current += 1;
    if (tickRef.current % 2 === 0) {
      setHistory(prev => {
        const snapshot = nodesRef.current.map(n => n.voltage);
        const next = [...prev, snapshot];
        return next.slice(-60);
      });
    }
  }, []);

  useAnimationFrame(step, running);

  // Draw graph on canvas
  useEffect(() => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let v = -80; v <= 40; v += 20) {
      const y = H - ((v - (-90)) / 140) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Central node (node 20) voltage over time
    const nodeIdx = 20;
    ctx.strokeStyle = "#7efff5";
    ctx.lineWidth = 2;
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#7efff5";
    ctx.beginPath();
    history.forEach((snap, i) => {
      const x = (i / (history.length - 1 || 1)) * W;
      const v = snap[nodeIdx] ?? RESTING_POTENTIAL;
      const y = H - ((v - (-90)) / 140) * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Labels
    ctx.fillStyle = "rgba(126,255,245,0.5)";
    ctx.font = "10px monospace";
    ctx.fillText("+40 мВ", 4, 14);
    ctx.fillText("−70 мВ", 4, H - ((RESTING_POTENTIAL - (-90)) / 140) * H - 4);
    ctx.fillText("−80 мВ", 4, H - ((REFRACTORY - (-90)) / 140) * H - 4);
  }, [history]);

  const midNode = nodes[Math.floor(MEMBRANE_LENGTH / 2)];
  const naOpen = midNode.phase === "rising";
  const kOpen = midNode.phase === "falling";

  const activeCount = nodes.filter(n => n.phase !== "rest").length;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#050d1a",
      fontFamily: "'Courier New', monospace",
      color: "#cde",
      padding: "20px",
      boxSizing: "border-box",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: 6, color: "#7efff5", textTransform: "uppercase", marginBottom: 6 }}>
          Нейробиофизика
        </div>
        <h1 style={{
          margin: 0,
          fontSize: "clamp(22px, 4vw, 36px)",
          fontWeight: 900,
          letterSpacing: 2,
          background: "linear-gradient(90deg, #7efff5, #a29bfe, #fd79a8)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>
          Симулятор потенциала действия
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#7a8fa6" }}>
          Электрический импульс нейрона · Электричество в живых организмах
        </p>
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Потенциал покоя", value: `${RESTING_POTENTIAL} мВ`, color: "#54a0ff" },
          { label: "Порог", value: `${THRESHOLD} мВ`, color: "#feca57" },
          { label: "Пик", value: `+${PEAK} мВ`, color: "#ff6b6b" },
          { label: "Стимулов", value: stimCount, color: "#7efff5" },
          { label: "Активных узлов", value: activeCount, color: "#a29bfe" },
        ].map(s => (
          <div key={s.label} style={{
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${s.color}33`,
            borderRadius: 8,
            padding: "8px 14px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#7a8fa6", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Axon visualization */}
      <div style={{
        background: "rgba(0,0,0,0.4)",
        borderRadius: 16,
        border: "1px solid rgba(126,255,245,0.1)",
        padding: "20px 16px",
        marginBottom: 20,
        overflow: "hidden",
      }}>
        <div style={{ fontSize: 11, color: "#7a8fa6", marginBottom: 12, letterSpacing: 2 }}>
          ▸ АКСОН НЕЙРОНА (мембрана)
        </div>
        <div style={{ display: "flex", gap: 2, alignItems: "center", overflowX: "auto", paddingBottom: 4 }}>
          {nodes.map((n, i) => {
            const heightPx = 18 + ((n.voltage - RESTING_POTENTIAL) / (PEAK - RESTING_POTENTIAL)) * 34;
            const col = voltageColor(n.voltage);
            const glow = n.phase !== "rest" ? `0 0 10px ${col}` : "none";
            return (
              <div key={n.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                {/* Ion indicator above */}
                <div style={{
                  width: 6, height: n.phase === "rising" ? 8 : n.phase === "falling" ? 6 : 0,
                  background: n.phase === "rising" ? "#ff9f43" : "#54a0ff",
                  borderRadius: 2,
                  marginBottom: 2,
                  transition: "height 0.1s",
                  opacity: n.phase !== "rest" ? 1 : 0,
                }} />
                {/* Node bar */}
                <div style={{
                  width: 7,
                  height: `${heightPx}px`,
                  background: col,
                  borderRadius: 3,
                  boxShadow: glow,
                  transition: "height 0.05s, background 0.05s",
                }} />
                {/* Index label every 10 */}
                {i % 10 === 0 && (
                  <div style={{ fontSize: 8, color: "#445", marginTop: 3 }}>{i}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          {[
            { color: "#1ec8ff", label: "Покой (−70 мВ)" },
            { color: "#ff9f43", label: "Деполяризация (Na⁺ входит)" },
            { color: "#ff4757", label: "Пик (+40 мВ)" },
            { color: "#54a0ff", label: "Реполяризация (K⁺ выходит)" },
            { color: "#2c3e6a", label: "Рефрактерность (−80 мВ)" },
          ].map(l => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: "#7a8fa6" }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Ion channels */}
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{
          flex: 1, minWidth: 220,
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,159,67,0.2)",
          borderRadius: 16,
          padding: 16,
        }}>
          <div style={{ fontSize: 11, color: "#7a8fa6", letterSpacing: 2, marginBottom: 12 }}>▸ ИОННЫЕ КАНАЛЫ (центр аксона)</div>
          <svg width="100%" height="90" viewBox="0 0 300 90">
            {/* Membrane lines */}
            <line x1="0" y1="30" x2="300" y2="30" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
            <line x1="0" y1="60" x2="300" y2="60" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
            <text x="0" y="20" fontSize="9" fill="#7a8fa6">Внешняя среда (Na⁺)</text>
            <text x="0" y="85" fontSize="9" fill="#7a8fa6">Цитоплазма (K⁺)</text>

            <IonChannel open={naOpen} ion="Na" x={70} y={45} />
            <IonChannel open={naOpen} ion="Na" x={130} y={45} />
            <IonChannel open={kOpen} ion="K" x={190} y={45} />
            <IonChannel open={kOpen} ion="K" x={250} y={45} />

            <text x="70" y="90" textAnchor="middle" fontSize="8" fill={naOpen ? "#ff9f43" : "#445"}>Na⁺ канал</text>
            <text x="130" y="90" textAnchor="middle" fontSize="8" fill={naOpen ? "#ff9f43" : "#445"}>Na⁺ канал</text>
            <text x="190" y="90" textAnchor="middle" fontSize="8" fill={kOpen ? "#54a0ff" : "#445"}>K⁺ канал</text>
            <text x="250" y="90" textAnchor="middle" fontSize="8" fill={kOpen ? "#54a0ff" : "#445"}>K⁺ канал</text>
          </svg>
          <div style={{ marginTop: 8, fontSize: 11, color: "#7a8fa6", lineHeight: 1.6 }}>
            {midNode.phase === "rest" && "🔵 Покой: каналы закрыты, потенциал −70 мВ"}
            {midNode.phase === "rising" && "🟠 Деполяризация: Na⁺ каналы открыты, ионы входят внутрь → потенциал растёт"}
            {midNode.phase === "falling" && "🔷 Реполяризация: K⁺ каналы открыты, ионы выходят → потенциал падает"}
            {midNode.phase === "refractory" && "⚫ Рефрактерность: каналы закрыты, Na⁺/K⁺ насос восстанавливает баланс"}
          </div>
        </div>

        {/* Graph */}
        <div style={{
          flex: 1, minWidth: 220,
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(126,255,245,0.15)",
          borderRadius: 16,
          padding: 16,
        }}>
          <div style={{ fontSize: 11, color: "#7a8fa6", letterSpacing: 2, marginBottom: 8 }}>▸ ГРАФИК НАПРЯЖЕНИЯ (узел 20)</div>
          <canvas ref={graphCanvasRef} width={340} height={120}
            style={{ width: "100%", height: 120, borderRadius: 8, background: "rgba(0,0,0,0.3)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#445", marginTop: 4 }}>
            <span>прошлое</span><span>настоящее</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        background: "rgba(0,0,0,0.4)",
        border: "1px solid rgba(126,255,245,0.1)",
        borderRadius: 16,
        padding: 20,
        display: "flex",
        gap: 16,
        alignItems: "center",
        flexWrap: "wrap",
      }}>
        <button onClick={stimulate} style={{
          background: "linear-gradient(135deg, #7efff5, #a29bfe)",
          border: "none",
          borderRadius: 10,
          padding: "12px 28px",
          fontFamily: "monospace",
          fontWeight: 700,
          fontSize: 14,
          color: "#050d1a",
          cursor: "pointer",
          letterSpacing: 1,
          boxShadow: "0 0 20px rgba(126,255,245,0.4)",
        }}>
          ⚡ СТИМУЛИРОВАТЬ
        </button>

        <button onClick={reset} style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 10,
          padding: "12px 24px",
          fontFamily: "monospace",
          fontWeight: 700,
          fontSize: 14,
          color: "#cde",
          cursor: "pointer",
          letterSpacing: 1,
        }}>
          ↺ СБРОС
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 180 }}>
          <span style={{ fontSize: 11, color: "#7a8fa6", whiteSpace: "nowrap" }}>Скорость: {speed}×</span>
          <input type="range" min="0.5" max="4" step="0.5" value={speed}
            onChange={e => setSpeed(+e.target.value)}
            style={{ flex: 1, accentColor: "#7efff5" }} />
        </div>

        <div style={{
          fontSize: 11, color: "#7a8fa6", lineHeight: 1.7, maxWidth: 280,
        }}>
          Нажмите <b style={{ color: "#7efff5" }}>СТИМУЛИРОВАТЬ</b>, чтобы запустить электрический импульс.
          Наблюдайте, как волна деполяризации распространяется по аксону.
        </div>
      </div>

      {/* Theory */}
      <div style={{
        marginTop: 20,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
      }}>
        {[
          { emoji: "1️⃣", title: "Покой", text: "Мембрана поляризована: внутри −70 мВ. Na⁺/K⁺ насос поддерживает баланс ионов." },
          { emoji: "2️⃣", title: "Деполяризация", text: "Стимул открывает Na⁺ каналы. Ионы натрия врываются внутрь → потенциал резко растёт до +40 мВ." },
          { emoji: "3️⃣", title: "Реполяризация", text: "Na⁺ каналы закрываются, открываются K⁺ каналы. Ионы калия выходят → потенциал падает." },
          { emoji: "4️⃣", title: "Гиперполяризация", text: "Кратковременное перепадение до −80 мВ. Нейрон не реагирует на новые стимулы (рефрактерность)." },
        ].map(c => (
          <div key={c.title} style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 12,
            padding: 14,
          }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{c.emoji}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#7efff5", marginBottom: 4 }}>{c.title}</div>
            <div style={{ fontSize: 11, color: "#7a8fa6", lineHeight: 1.6 }}>{c.text}</div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center", marginTop: 20, fontSize: 10, color: "#2a3a4a" }}>
        Модель Ходжкина–Хаксли (упрощённая) · Физика 2026 · Электричество в живых организмах
      </div>
    </div>
  );
}