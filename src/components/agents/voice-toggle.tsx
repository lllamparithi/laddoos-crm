'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Mic } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

// The website's browser voice widget (useVoiceRoom.ts -> /api/livekit-token
// in laddoos-website), NOT the telephony phone line — that's a separate
// always-on VPS service this toggle can't reach. See the Kyochi-port plan.
export function VoiceToggle() {
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);

  // Same account-switch guard fetchConfig() in ai-config.tsx uses.
  const loadedRef = useRef(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/yali/voice-config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Could not load voice status.');
        return;
      }
      setEnabled(Boolean(data.enabled));
    } catch {
      toast.error('Could not load voice status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void fetchConfig();
  }, [fetchConfig]);

  const handleToggle = async (next: boolean) => {
    setSaving(true);
    setEnabled(next); // optimistic — reverted below on failure
    try {
      const res = await fetch('/api/yali/voice-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEnabled(!next);
        toast.error(data.error ?? 'Failed to save.');
        return;
      }
      toast.success(next ? 'Voice widget enabled.' : 'Voice widget disabled.');
    } catch {
      setEnabled(!next);
      toast.error('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="h-4 w-4" /> Website voice widget
        </CardTitle>
        <CardDescription>
          Turns the storefront&apos;s speech-to-speech voice orb on or off for visitors. Does not
          affect the phone line — that runs as a separate, always-on service.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={handleToggle} disabled={!canEdit || saving} />
            <span className="text-sm text-foreground">{enabled ? 'Live' : 'Off'}</span>
          </div>
        )}
        {!canEdit && (
          <p className="mt-2 text-xs text-muted-foreground">
            Only account admins and owners can change this.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
