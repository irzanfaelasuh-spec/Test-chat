import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.veyra.chat',
  appName: 'Veyra',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#0d1117'
  }
};

export default config;
