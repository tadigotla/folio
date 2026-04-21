import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4">
      <h1 className="mb-2 text-2xl font-bold">Video not found</h1>
      <p className="mb-4 text-muted-foreground">
        This video isn&apos;t in the library (yet). It may have been dismissed, or the link is incorrect.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Home
      </Link>
    </div>
  );
}
