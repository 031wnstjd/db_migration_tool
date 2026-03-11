import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DB Migrator Tool',
  description: 'DB-agnostic 데이터 마이그레이션 프론트엔드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="page">
          <header className="container header">
            <div>
              <h1 className="page-title">DB MIGRATOR TOOL</h1>
              <p className="helper">Neo Brutalism UI로 리디자인</p>
            </div>
            <span className="header-chip">FastAPI + Next.js</span>
          </header>
          <main className="container">{children}</main>
        </div>
      </body>
    </html>
  );
}
