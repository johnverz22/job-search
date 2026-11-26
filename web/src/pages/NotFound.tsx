import { Link } from 'react-router-dom';
import { btnPrimary, useTitle } from '../components/ui';

export function NotFoundView({ title = 'Page not found', message = 'The page you’re looking for doesn’t exist.' }: { title?: string; message?: string }) {
  useTitle(title);
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted">{message}</p>
      <Link to="/" className={`${btnPrimary} mt-6`}>Back to jobs</Link>
    </div>
  );
}

export const Component = () => <NotFoundView />;
