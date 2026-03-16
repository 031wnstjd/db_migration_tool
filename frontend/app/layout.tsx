import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DB Managing Tool',
  description: 'DB migration and DDL management workspace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="page">
          <header className="container header">
            <div>
              <h1 className="page-title">DB MANAGING TOOL</h1>
              <p className="helper">Migration과 DDL 작업을 한 곳에서 관리합니다.</p>
            </div>
          </header>
          <main className="container">{children}</main>
        </div>
      </body>
    </html>
  );
}
