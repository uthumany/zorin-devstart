/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEVSTART_SIGNED_UPDATER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
