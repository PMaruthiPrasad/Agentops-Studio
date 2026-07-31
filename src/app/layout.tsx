import type { Metadata, Viewport } from 'next';
import '@xyflow/react/dist/style.css';
import './globals.css';
import { AppShell } from '@/components/layout/app-shell';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: {
    default: 'AgentOps Studio',
    template: '%s · AgentOps Studio',
  },
  description:
    'Build, execute, and optimize AI agent systems. A visual workflow engine with per-step telemetry, cost analytics, and an automated workflow optimizer.',
  applicationName: 'AgentOps Studio',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0e' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` is required by next-themes: it sets the theme
    // class on <html> before React hydrates, which is the point.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
