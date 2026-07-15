'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { FileText, AlertTriangle, Wrench, History } from 'lucide-react';

interface TabsShellProps {
  children: React.ReactNode;
}

const TABS = [
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'defects', label: 'Defects', icon: AlertTriangle },
  { key: 'maintenance', label: 'Maintenance', icon: Wrench },
  { key: 'odometer', label: 'Odometer', icon: History },
] as const;

export function TabsShell({ children }: TabsShellProps) {
  const [activeTab, setActiveTab] = useState(0);

  const childrenArray = Array.isArray(children) ? children : [children];

  return (
    <Card>
      <div className="border-b border-border">
        <div className="flex">
          {TABS.map((tab, i) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(i)}
                className={cn(
                  'flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-[1px]',
                  activeTab === i
                    ? 'border-brand-800 text-ink-950'
                    : 'border-transparent text-ink-500 hover:text-ink-700',
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      {childrenArray[activeTab] ?? (
        <div className="px-5 py-8 text-center text-sm text-ink-500">
          No content available.
        </div>
      )}
    </Card>
  );
}
