import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cymortech.todo',
  appName: 'CYMOR TO-DO',
  webDir: 'dist',
  backgroundColor: '#0a0907',
  android: { allowMixedContent: false },
  server: { androidScheme: 'https' },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#0a0907', androidScaleType: 'CENTER_INSIDE', showSpinner: false },
    LocalNotifications: { smallIcon: 'ic_stat_cymor', iconColor: '#D4AF37' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};
export default config;
