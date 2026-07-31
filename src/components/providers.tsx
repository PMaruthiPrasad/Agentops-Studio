'use client';

import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/components/theme-provider';

/** Every client-side context the app needs, in one place. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={250} skipDelayDuration={400}>
        {children}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
