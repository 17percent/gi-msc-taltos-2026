import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="max-w-(--read-width)">
      <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight">
        Ez az oldal nem létezik
      </h1>
      <p className="mt-4 text-muted">Lehet, hogy elírtad a címet, vagy az oldal már máshol van.</p>
      <Link
        to="/"
        className="mt-6 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-on-primary transition-colors duration-(--duration-fast) ease-standard hover:bg-primary-hover"
      >
        Vissza a kezdőoldalra
      </Link>
    </section>
  );
}
