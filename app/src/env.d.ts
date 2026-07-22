/// <reference types="astro/client" />
/// <reference types="vite/client" />
/// <reference types="w3c-web-usb" />

interface ImportMetaEnv {
  readonly CLOUD_CLIENT_VERSION_ID?: string;
  readonly CLOUD_CLIENT_SECRET?: string;
  readonly CLOUD_API_BASE?: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

interface Window {
  posthog?: {
    capture: (event: string, properties?: Record<string, unknown>) => void;
  };
  // Populated by the early inline script (src/components/pwa-early.astro) so the
  // beforeinstallprompt event isn't lost before the SolidJS island hydrates.
  __pwaInstall?: {
    deferred: BeforeInstallPromptEvent | null;
    installed: boolean;
    onDeferred?: (e: BeforeInstallPromptEvent) => void;
    onInstalled?: () => void;
  };
}
