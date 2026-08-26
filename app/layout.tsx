import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DESIGN STOCK',
  description: 'Web design reference stock and study archive'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
