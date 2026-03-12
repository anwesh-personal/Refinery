import { FileQuestion } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/UI';

export default function NotFoundPage() {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', textAlign: 'center',
        padding: 48, minHeight: 400,
      }}
    >
      <div
        style={{
          width: 64, height: 64, borderRadius: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-card-hover)', color: 'var(--text-tertiary)',
          marginBottom: 20,
        }}
      >
        <FileQuestion size={28} />
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
        Page Not Found
      </h3>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', maxWidth: 360, marginBottom: 24 }}>
        The page you are looking for doesn't exist or you don't have access to it.
      </p>
      <Link to="/">
        <Button>Return to Dashboard</Button>
      </Link>
    </div>
  );
}
