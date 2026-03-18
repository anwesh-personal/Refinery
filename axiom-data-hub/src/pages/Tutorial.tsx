import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CloudDownload, Database, Filter, ShieldCheck, 
  Send, Zap, ChevronRight, CheckCircle2, 
  MousePointer2, Network, Sparkles, Server, Mail
} from 'lucide-react';

const TUTORIAL_STEPS = [
  {
    id: 'ingestion',
    label: 'Ingestion Phase',
    title: '1. S3 Auto-Ingestion',
    icon: <CloudDownload size={28} />,
    color: 'var(--blue)',
    gradient: 'linear-gradient(135deg, rgba(59,130,246,0.2) 0%, rgba(59,130,246,0) 100%)',
    content: 'Connect S3 buckets and configure Auto-Rules. The system hunts for wild CSVs, GZs, and Parquets, ripping them down and converting them to highly optimized columnar formats while you sleep.',
    bullets: ['Automatic format detection', 'Scheduled cron ingestion rules', 'Real-time progress animations'],
    link: '/ingestion',
    linkText: 'Configure S3 Sources'
  },
  {
    id: 'database',
    label: 'Storage Phase',
    title: '2. ClickHouse Lake',
    icon: <Database size={28} />,
    color: 'var(--green)',
    gradient: 'linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(16,185,129,0) 100%)',
    content: 'Data hits the ClickHouse lake. It’s an insanely fast, analytical database capable of querying billions of rows in milliseconds. This is where your master list lives and groans under its own weight.',
    bullets: ['Dynamic schema generation', 'Instant pagination', 'Columnar groupings'],
    link: '/database',
    linkText: 'Explore Database'
  },
  {
    id: 'segments',
    label: 'Targeting Phase',
    title: '3. Segmentation',
    icon: <Filter size={28} />,
    color: 'var(--purple)',
    gradient: 'linear-gradient(135deg, rgba(168,85,247,0.2) 0%, rgba(168,85,247,0) 100%)',
    content: 'Slice the ocean of data into highly targeted puddles. Build complex AND/OR logic trees to find exactly who you want to talk to. "CEOs in Texas who use AWS" — done in seconds.',
    bullets: ['Visual query builder', 'Real-time audience sizing', 'Saved segment snapshots'],
    link: '/segments',
    linkText: 'Build a Segment'
  },
  {
    id: 'verification',
    label: 'Cleaning Phase',
    title: '4. Verification Engine',
    icon: <ShieldCheck size={28} />,
    color: 'var(--yellow)',
    gradient: 'linear-gradient(135deg, rgba(234,179,8,0.2) 0%, rgba(234,179,8,0) 100%)',
    content: 'Throw your segment into the meat grinder. We ping mail servers, execute MX lookups, catch honeypots, and automatically fix typos (gmial -> gmail). Only valid, pristine emails survive.',
    bullets: ['Live SMTP handshake testing', 'Role-based & Catch-all detection', 'Syntax auto-correction'],
    link: '/verification',
    linkText: 'Verify a List'
  },
  {
    id: 'delivery',
    label: 'Execution Phase',
    title: '5. Autoresponder',
    icon: <Send size={28} />,
    color: 'var(--accent)',
    gradient: 'linear-gradient(135deg, rgba(244,63,94,0.2) 0%, rgba(244,63,94,0) 100%)',
    content: 'The survivors are loaded into the payload bay. Construct multi-step email sequences, rotate between dozens of warm SMTP profiles, and watch the replies roll in.',
    bullets: ['Multi-SMTP inbox rotation', 'Drip sequence timing logs', 'Vault-encrypted credentials'],
    link: '/targets',
    linkText: 'Send a Campaign'
  }
];

export default function TutorialPage() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mouse trail tracker for the hero
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Scroll observer to trigger entrances
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -50px 0px" });

    document.querySelectorAll('.animate-entrance').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div 
      className="tutorial-page" 
      style={{ paddingBottom: 100, overflowX: 'hidden' }}
    >
      {/* ─── ULTRA PREMIUM HERO ─── */}
      <div 
        ref={containerRef}
        onMouseMove={handleMouseMove}
        className="animate-fadeIn"
        style={{
          position: 'relative',
          padding: '100px 40px',
          textAlign: 'center',
          background: 'var(--bg-card)',
          borderRadius: 32,
          border: '1px solid var(--border)',
          overflow: 'hidden',
          marginBottom: 80,
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
        }}
      >
        {/* Interactive background glow tied to mouse */}
        <div style={{
          position: 'absolute',
          top: mousePos.y - 300,
          left: mousePos.x - 300,
          width: 600, height: 600,
          background: 'radial-gradient(circle, var(--accent-muted) 0%, transparent 70%)',
          pointerEvents: 'none',
          opacity: 0.5,
          transition: 'opacity 0.3s',
          zIndex: 0
        }} />

        {/* Hero Content */}
        <div style={{ position: 'relative', zIndex: 10, maxWidth: 800, margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 999,
            background: 'var(--bg-hover)', border: '1px solid var(--border)',
            color: 'var(--accent)', fontSize: 13, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.1em',
            marginBottom: 24, boxShadow: '0 0 20px rgba(244,63,94,0.2)'
          }}>
            <Sparkles size={16} /> Interactive Mastery
          </div>
          
          <h1 style={{
            fontSize: 'clamp(40px, 6vw, 72px)',
            fontWeight: 900,
            lineHeight: 1.05,
            letterSpacing: '-0.04em',
            color: 'var(--text-primary)',
            marginBottom: 24,
            textShadow: '0 10px 30px rgba(0,0,0,0.3)'
          }}>
            The <span style={{ color: 'var(--accent)' }}>Data Flow</span> Engine.
          </h1>
          
          <p style={{
            fontSize: 'clamp(16px, 2vw, 20px)',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            fontWeight: 400
          }}>
            Let's trace a raw CSV file's journey from an S3 bucket all the way to a verified prospect's inbox. 
            Scroll down to see the architecture, or click any interactive card to instantly jump into that module.
          </p>
        </div>

        {/* Animated grid background */}
        <div className="bg-grid-pattern" style={{
          position: 'absolute', inset: 0, zIndex: 0, opacity: 0.15,
          backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 80%)'
        }} />
      </div>

      {/* ─── INTERACTIVE STEPS TIMELINE ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 40, maxWidth: 1000, margin: '0 auto', position: 'relative' }}>
        
        {/* Animated Pipeline Stem connecting the steps */}
        <div className="pipeline-stem" style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          bottom: 0,
          width: 4,
          background: 'var(--bg-hover)',
          transform: 'translateX(-50%)',
          borderRadius: 4,
          zIndex: 0
        }}>
          {/* Animated flowing data element inside the stem */}
          <div style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            background: 'linear-gradient(to bottom, transparent, var(--accent), transparent)',
            backgroundSize: '100% 200%',
            animation: 'dataFlow 3s linear infinite',
            opacity: 0.6
          }} />
        </div>

        {/* STEPS */}
        {TUTORIAL_STEPS.map((step, index) => {
          const isEven = index % 2 === 0;
          const isActive = activeStep === index;

          return (
            <div 
              key={step.id} 
              className={`animate-entrance step-row ${isEven ? 'row-even' : 'row-odd'}`}
              onMouseEnter={() => setActiveStep(index)}
              onMouseLeave={() => setActiveStep(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 40,
                position: 'relative',
                zIndex: 10
              }}
            >
              {/* Connector dot on the pipeline */}
              <div style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: `translate(-50%, -50%) scale(${isActive ? 1.5 : 1})`,
                width: 16, height: 16,
                borderRadius: '50%',
                background: 'var(--bg-app)',
                border: `4px solid ${isActive ? step.color : 'var(--border)'}`,
                boxShadow: isActive ? `0 0 20px ${step.color}` : 'none',
                transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                zIndex: 5
              }} />

              {/* Left Side: Empty spacer OR Content if even */}
              <div style={{ flex: 1, display: 'flex', justifyContent: isEven ? 'flex-end' : 'flex-start' }}>
                {isEven ? (
                  <ContentCard step={step} isActive={isActive} navigate={navigate} />
                ) : (
                  <VisualDemoBox step={step} isActive={isActive} />
                )}
              </div>

              {/* Center spacer for pipeline */}
              <div style={{ width: 40, flexShrink: 0 }} />

              {/* Right Side: Empty spacer OR Content if odd */}
              <div style={{ flex: 1, display: 'flex', justifyContent: isEven ? 'flex-start' : 'flex-end' }}>
                {!isEven ? (
                  <ContentCard step={step} isActive={isActive} navigate={navigate} />
                ) : (
                  <VisualDemoBox step={step} isActive={isActive} />
                )}
              </div>

            </div>
          );
        })}
      </div>

      {/* ─── STYLES ─── */}
      <style>{`
        /* Entrance Animations */
        .animate-entrance {
          opacity: 0;
          transform: translateY(40px);
          transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .animate-entrance.in-view {
          opacity: 1;
          transform: translateY(0);
        }

        /* Continuous Data Flow Animation */
        @keyframes dataFlow {
          0% { background-position: 50% -100%; }
          100% { background-position: 50% 200%; }
        }

        @keyframes pulseGlow {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.1); opacity: 1; }
        }

        .action-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }

        /* Mobile Adjustments */
        @media (max-width: 900px) {
          .pipeline-stem { display: none; }
          .step-row {
            flex-direction: column !important;
            gap: 20px !important;
          }
          .step-row > div {
            width: 100% !important;
            justify-content: center !important;
          }
        }
      `}</style>
    </div>
  );
}

// ─── HELPER COMPONENTS ───

function ContentCard({ step, isActive, navigate }: { step: any, isActive: boolean, navigate: any }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${isActive ? step.color : 'var(--border)'}`,
      borderRadius: 24,
      padding: 40,
      width: '100%',
      maxWidth: 460,
      boxShadow: isActive ? `0 20px 40px ${step.color}15` : '0 10px 20px rgba(0,0,0,0.1)',
      transform: isActive ? 'scale(1.02) translateY(-5px)' : 'scale(1) translateY(0)',
      transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: step.bg, color: step.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: isActive ? `0 0 20px ${step.color}` : 'none',
          transition: 'all 0.3s'
        }}>
          {step.icon}
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: step.color }}>
            {step.label}
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            {step.title}
          </h2>
        </div>
      </div>

      <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
        {step.content}
      </p>

      <ul style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32, padding: 0, listStyle: 'none' }}>
        {step.bullets.map((bullet: string, i: number) => (
          <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>
            <CheckCircle2 size={16} color={step.color} style={{ opacity: isActive ? 1 : 0.5, transition: 'all 0.3s' }} />
            {bullet}
          </li>
        ))}
      </ul>

      <button 
        className="action-button"
        onClick={() => navigate(step.link)}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: step.color, color: '#fff',
          border: 'none', borderRadius: 12, padding: '14px 20px',
          fontSize: 14, fontWeight: 700, cursor: 'pointer',
          transition: 'all 0.2s'
        }}
      >
        <span>{step.linkText}</span>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function VisualDemoBox({ step, isActive }: { step: any, isActive: boolean }) {
  // A sleek, abstract representation of the UI state to sit opposite the text card
  return (
    <div style={{
      width: '100%',
      maxWidth: 380,
      height: 380,
      borderRadius: 32,
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'var(--shadow-sm)',
      transform: isActive ? 'rotateX(5deg) rotateY(-5deg) scale(1.05)' : 'rotateX(0) rotateY(0) scale(1)',
      transition: 'all 0.5s ease',
      perspective: 1000
    }}>
      {/* Dynamic abstract gradient background */}
      <div style={{
        position: 'absolute', inset: 0,
        background: step.gradient,
        opacity: isActive ? 1 : 0.3,
        transition: 'opacity 0.4s'
      }} />

      {/* Center abstract UI element */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20
      }}>
        {/* Pulsing ring */}
        <div style={{
          position: 'relative',
          width: 120, height: 120,
          borderRadius: '50%',
          background: 'var(--bg-app)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `2px solid ${step.color}40`,
          boxShadow: isActive ? `0 0 50px ${step.color}40` : 'none',
          transition: 'all 0.4s'
        }}>
          {/* Inner ring */}
          <div style={{
            position: 'absolute', inset: 10, borderRadius: '50%',
            border: `2px dashed ${step.color}`,
            animation: isActive ? 'spin 10s linear infinite' : 'none',
            opacity: 0.5
          }} />
          {React.cloneElement(step.icon, { size: 48, color: step.color, style: { animation: isActive ? 'pulseGlow 2s infinite' : 'none' } })}
        </div>
        
        {/* Animated mock data lines */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <div style={{ height: 6, width: 80, background: 'var(--bg-hover)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: isActive ? '100%' : '0%', background: step.color, transition: 'width 1.5s ease-out' }} />
          </div>
          <div style={{ height: 6, width: 120, background: 'var(--bg-hover)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: isActive ? '60%' : '0%', background: step.color, transition: 'width 1.5s ease-out 0.2s' }} />
          </div>
          <div style={{ height: 6, width: 60, background: 'var(--bg-hover)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: isActive ? '85%' : '0%', background: step.color, transition: 'width 1.5s ease-out 0.4s' }} />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
