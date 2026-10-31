import { Link } from 'react-router-dom';
import { ShieldOff, Compass } from 'lucide-react';
import { useSession } from '../lib/session';

export function ForbiddenPage({ reason }: { reason?: string }) {
  const { session } = useSession();
  return (
    <div className="mx-auto mt-20 max-w-md text-center">
      <ShieldOff className="mx-auto text-ink-muted" size={32} />
      <h1 className="mt-3 font-display text-2xl font-semibold">This is outside your access</h1>
      <p className="mt-2 text-ink-soft">{reason ?? 'Your role does not include this page or project.'}</p>
      {session && <p className="mt-1 text-[12.5px] text-ink-muted">Signed in as {session.user.full_name}, {session.persona.name}. Ask the engagement partner if you need access.</p>}
      <div className="mt-5 flex justify-center gap-2">
        <Link to="/" className="rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-dark">Go to dashboard</Link>
        <Link to="/login" className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-canvas">Switch persona</Link>
      </div>
    </div>
  );
}

export function NotFoundPage({ what = 'page' }: { what?: string }) {
  return (
    <div className="mx-auto mt-20 max-w-md text-center">
      <Compass className="mx-auto text-ink-muted" size={32} />
      <h1 className="mt-3 font-display text-2xl font-semibold">We could not find that {what}</h1>
      <p className="mt-2 text-ink-soft">It may have been removed, or the link is wrong.</p>
      <Link to="/" className="mt-5 inline-block rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-dark">Go to dashboard</Link>
    </div>
  );
}
