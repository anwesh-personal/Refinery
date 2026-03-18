import { useState, useEffect } from 'react';
import { Button } from '../components/UI';
import { useNavigate } from 'react-router-dom';
import { 
  CloudDownload, Database, Filter, ShieldCheck, 
  Send, Zap, ChevronRight, 
  CheckCircle2, MousePointer2 
} from 'lucide-react';

// Animation and Hover effects are handled via inline CSS and classes
const tutorialData = [
  {
    id: 'ingestion',
    title: '1. Ingestion',
    subtitle: 'Bringing Data Home',
    icon: <CloudDownload size={32} />,
    color: 'var(--blue)',
    bg: 'var(--blue-muted)',
    content: `Think of S3 Ingestion as our giant funnel. We connect to remote buckets where raw data lives, download it, and automatically organize it into our lightning-fast ClickHouse database.`,
    features: [
      'Connect external S3 buckets safely.',
      'Auto-detects CSV, GZ, and Parquet.',
      'Set Auto-Ingestion Rules to pull data while you sleep.'
    ],
    link: '/ingestion',
    actionText: 'Go to Ingestion',
  },
  {
    id: 'database',
    title: '2. ClickHouse Database',
    subtitle: 'Your Data Lake',
    icon: <Database size={32} />,
    color: 'var(--green)',
    bg: 'var(--green-muted)',
    content: `Once ingested, data lands in ClickHouse. This is an insanely fast database where you can search through millions of rows in milliseconds.`,
    features: [
      'Browse through all your data in a single view.',
      'Write custom SQL queries for advanced extraction.',
      'Filter columns, sort by data source, and export easily.'
    ],
    link: '/database',
    actionText: 'Explore Database',
  },
  {
    id: 'segments',
    title: '3. Segmentation',
    subtitle: 'Dividing and Conquering',
    icon: <Filter size={32} />,
    color: 'var(--purple)',
    bg: 'var(--purple-muted)',
    content: `We don't need all data at once. Segments allow us to slice up the database into bite-sized audiences. For example, "CEOs in Texas."`,
    features: [
      'Create lists from complex filters.',
      'They act as the source material for the next phase: Verification.'
    ],
    link: '/segments',
    actionText: 'Manage Segments',
  },
  {
    id: 'verification',
    title: '4. Verification Engine',
    subtitle: 'The ultimate bouncer',
    icon: <ShieldCheck size={32} />,
    color: 'var(--yellow)',
    bg: 'var(--yellow-muted)',
    content: `The Verification Engine checks every single email address. Is it real? Is it a risky catch-all? Is the inbox full? Only the pristine emails make it through.`,
    features: [
      'Fix typos automatically (gmial -> gmail).',
      'Ping mail servers via SMTP to ensure they exist.',
      'Score emails on risk to decide if they should be emailed.'
    ],
    link: '/verification',
    actionText: 'Run Verification',
  },
  {
    id: 'delivery',
    title: '5. Delivery & Autoresponder',
    subtitle: 'Sending the message',
    icon: <Send size={32} />,
    color: 'var(--accent)',
    bg: 'var(--accent-muted)',
    content: `Finally, verified emails get sent down the pipeline. We push them to our Autoresponder Engine which orchestrates the actual sending of emails.`,
    features: [
      'Create custom email sequences.',
      'Track opens, clicks, and responses.',
      'Manage multiple SMTP sending accounts securely.'
    ],
    link: '/targets',
    actionText: 'View Targets',
  }
];

export default function TutorialPage() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState<string | null>(null);
  
  // Create an intersection observer for scroll animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.1 }
    );

    const elements = document.querySelectorAll('.animate-on-scroll');
    elements.forEach((el) => observer.observe(el));

    return () => elements.forEach((el) => observer.unobserve(el));
  }, []);

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Banner */}
      <div 
        className="tutorial-hero animate-fadeIn"
        style={{
          background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--accent-muted) 100%)',
          border: '1px solid var(--border)',
          borderRadius: 24,
          padding: '60px 40px',
          textAlign: 'center',
          marginBottom: 60,
          position: 'relative',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)'
        }}
      >
        <div style={{ position: 'relative', zIndex: 10 }}>
          <div style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: 8, 
            background: 'var(--accent)', 
            color: '#fff', 
            padding: '6px 16px', 
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: 20
          }}>
            <Zap size={14} /> System Mastery
          </div>
          <h1 style={{ 
            fontSize: 'clamp(32px, 5vw, 56px)', 
            fontWeight: 900, 
            letterSpacing: '-0.03em', 
            color: 'var(--text-primary)',
            marginBottom: 20,
            lineHeight: 1.1
          }}>
            How Refinery Nexus Works.
          </h1>
          <p style={{ 
            fontSize: 18, 
            color: 'var(--text-secondary)', 
            maxWidth: 600, 
            margin: '0 auto',
            lineHeight: 1.6
          }}>
            A step-by-step interactive guide. Hover over sections to learn how data flows from 
            raw ingestion to polished email delivery. You can literally click the links to jump straight to the action.
          </p>
        </div>
      </div>

      {/* Guide Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 40, position: 'relative' }}>
        {/* Connecting line */}
        <div style={{ 
          position: 'absolute', 
          left: 48, 
          top: 40, 
          bottom: 40, 
          width: 4, 
          background: 'var(--border)',
          borderRadius: 4,
          zIndex: 0
        }} className="tutorial-line" />

        {tutorialData.map((step) => (
          <div 
            key={step.id} 
            className="animate-on-scroll step-card" 
            onMouseEnter={() => setActiveStep(step.id)}
            onMouseLeave={() => setActiveStep(null)}
            style={{ 
              display: 'flex', 
              gap: 40, 
              alignItems: 'flex-start',
              position: 'relative',
              zIndex: 1,
              opacity: 0, // for intersection observer
              transform: 'translateY(30px)',
              transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            {/* Number Icon */}
            <div style={{
              width: 96,
              height: 96,
              borderRadius: 24,
              background: step.bg,
              color: step.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              border: `2px solid ${activeStep === step.id ? step.color : 'transparent'}`,
              boxShadow: activeStep === step.id ? `0 0 30px ${step.bg}` : 'var(--shadow-sm)',
              transition: 'all 0.3s ease',
              transform: activeStep === step.id ? 'scale(1.1) rotate(5deg)' : 'scale(1)'
            }}>
              {step.icon}
            </div>

            {/* Content Box */}
            <div style={{
              flex: 1,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 24,
              padding: 40,
              boxShadow: activeStep === step.id ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
              transition: 'all 0.3s ease',
              transform: activeStep === step.id ? 'translateX(10px)' : 'translateX(0)',
              borderColor: activeStep === step.id ? step.color : 'var(--border)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 20 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: step.color, marginBottom: 8 }}>
                    {step.title}
                  </h3>
                  <h2 style={{ fontSize: 32, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 16, letterSpacing: '-0.02em' }}>
                    {step.subtitle}
                  </h2>
                  <p style={{ fontSize: 16, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 600, marginBottom: 24 }}>
                    {step.content}
                  </p>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
                    {step.features.map((feat, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: step.bg, color: step.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <CheckCircle2 size={14} />
                        </div>
                        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div 
                  className="interactive-demo"
                  style={{
                    padding: 24, 
                    background: 'var(--bg-hover)', 
                    borderRadius: 16, 
                    width: '100%', 
                    maxWidth: 300,
                    textAlign: 'center',
                    border: '1px dashed var(--border)',
                    transform: activeStep === step.id ? 'scale(1.05)' : 'scale(1)',
                    transition: 'all 0.4s ease'
                  }}
                >
                  <MousePointer2 size={32} color={step.color} style={{ margin: '0 auto 16px', opacity: activeStep === step.id ? 1 : 0.4, transition: 'all 0.3s' }} />
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    Try it out now
                  </div>
                  <Button 
                    style={{ background: step.color, color: '#fff', width: '100%', justifyContent: 'center' }}
                    onClick={() => navigate(step.link)}
                    icon={<ChevronRight size={16} />}
                  >
                    {step.actionText}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .animate-on-scroll.visible {
          opacity: 1 !important;
          transform: translateY(0) !important;
        }
        @media (max-width: 768px) {
          .tutorial-line {
            display: none;
          }
          .step-card {
            flex-direction: column;
            gap: 20px !important;
          }
        }
      `}</style>
    </div>
  );
}
