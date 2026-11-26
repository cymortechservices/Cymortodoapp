package com.cymortech.todo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

/**
 * The part that makes it a real alarm: a foreground service that plays the alarm sound on the ALARM audio stream
 * (own volume, not the notification volume), vibrates, wakes the screen and shows a full-screen alert over the lock screen.
 * It rings for up to a minute, then rings again (up to the repeat count) unless the user checks in, snoozes or stops it.
 */
public class AlarmService extends Service {
    static final String ACTION_RING = "com.cymortech.todo.RING";
    static final String ACTION_STOP = "com.cymortech.todo.STOP";
    static final String ACTION_SNOOZE = "com.cymortech.todo.SNOOZE";
    private static final String CH_RING = "cymor_alarm_ring";
    private static final String CH_MISSED = "cymor_alarm_missed";
    private static final int NOTIF_RING = 7001;
    private static final long RING_MS = 60_000;
    private static final long REPEAT_GAP_MS = 60_000;
    private static final long SNOOZE_MS = 5 * 60_000;

    static volatile boolean ringing = false;
    static volatile String ringingTitle = "";
    static volatile String ringingSource = "";
    static volatile long ringingSince = 0;

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private AudioManager audio;
    private int previousVolume = -1;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::onRingTimeout;

    private int curId;
    private String curTitle = "", curBody = "", curSource = "";
    private int curRepeats;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopRinging(false);
            return START_NOT_STICKY;
        }
        if (ACTION_SNOOZE.equals(action)) {
            readExtras(intent);
            AlarmScheduler.add(this, AlarmScheduler.make(curId, System.currentTimeMillis() + SNOOZE_MS, curTitle, curBody, curSource, curRepeats));
            stopRinging(false);
            return START_NOT_STICKY;
        }
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        readExtras(intent);
        startRinging();
        return START_NOT_STICKY;
    }

    private void readExtras(Intent i) {
        curId = i.getIntExtra(AlarmScheduler.X_ID, 0);
        curTitle = nz(i.getStringExtra(AlarmScheduler.X_TITLE), "Activity");
        curBody = nz(i.getStringExtra(AlarmScheduler.X_BODY), "It is time to start.");
        curSource = nz(i.getStringExtra(AlarmScheduler.X_SOURCE), "");
        curRepeats = i.getIntExtra(AlarmScheduler.X_REPEATS, 0);
    }

    private static String nz(String s, String d) {
        return s == null || s.isEmpty() ? d : s;
    }

    private PendingIntent activityIntent(int req, String action) {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra(AlarmScheduler.X_RINGING, true);
        i.putExtra(AlarmScheduler.X_SOURCE, curSource);
        if (action != null) i.putExtra(AlarmScheduler.X_ACTION, action);
        return PendingIntent.getActivity(this, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent serviceIntent(int req, String action) {
        Intent i = new Intent(this, AlarmService.class);
        i.setAction(action);
        i.putExtra(AlarmScheduler.X_ID, curId);
        i.putExtra(AlarmScheduler.X_TITLE, curTitle);
        i.putExtra(AlarmScheduler.X_BODY, curBody);
        i.putExtra(AlarmScheduler.X_SOURCE, curSource);
        i.putExtra(AlarmScheduler.X_REPEATS, curRepeats);
        return PendingIntent.getService(this, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void channels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel ring = new NotificationChannel(CH_RING, "Alarm (ringing)", NotificationManager.IMPORTANCE_HIGH);
        ring.setDescription("Shown while the alarm is ringing");
        ring.setSound(null, null); // the service plays the sound itself, on the alarm stream
        ring.enableVibration(false);
        ring.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ring);
        NotificationChannel missed = new NotificationChannel(CH_MISSED, "Missed alarms", NotificationManager.IMPORTANCE_DEFAULT);
        nm.createNotificationChannel(missed);
    }

    private void startRinging() {
        // If something was already ringing, replace it with the newest alarm.
        releaseMedia();
        channels();
        Notification n = new NotificationCompat.Builder(this, CH_RING)
                .setSmallIcon(R.drawable.ic_stat_cymor)
                .setContentTitle("TIME TO START: " + curTitle)
                .setContentText(curBody)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(activityIntent(1, null))
                .setFullScreenIntent(activityIntent(2, null), true)
                .addAction(0, "I am starting", activityIntent(3, "check-in"))
                .addAction(0, "Snooze 5 min", serviceIntent(4, ACTION_SNOOZE))
                .addAction(0, "Stop", serviceIntent(5, ACTION_STOP))
                .build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_RING, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIF_RING, n);

        ringing = true;
        ringingTitle = curTitle;
        ringingSource = curSource;
        ringingSince = System.currentTimeMillis();

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "cymor:alarm");
            wakeLock.acquire(RING_MS + 5_000);
        }
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        try {
            int max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            previousVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM);
            int target = Math.max(1, Math.round(max * 0.85f));
            if (previousVolume < target) audio.setStreamVolume(AudioManager.STREAM_ALARM, target, 0);
            else previousVolume = -1; // nothing to restore
        } catch (Exception ignored) {
            previousVolume = -1;
        }
        try {
            player = new MediaPlayer();
            AssetFileDescriptor afd = getResources().openRawResourceFd(R.raw.cymor_alarm);
            player.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            afd.close();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            releaseMedia(); // vibration and the full-screen alert still work
        }
        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            long[] pattern = {0, 900, 600};
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                else vibrator.vibrate(pattern, 0);
            }
        } catch (Exception ignored) { /* no vibration hardware */ }

        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, RING_MS);
    }

    private void onRingTimeout() {
        String title = curTitle, body = curBody, source = curSource;
        int id = curId, repeats = curRepeats;
        stopRinging(false);
        if (repeats > 0) {
            // still not started: ring again shortly (new id so it never collides with the one that just fired)
            AlarmScheduler.add(this, AlarmScheduler.make(id + 1, System.currentTimeMillis() + REPEAT_GAP_MS, title, body, source, repeats - 1));
        } else {
            channels();
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            Notification m = new NotificationCompat.Builder(this, CH_MISSED)
                    .setSmallIcon(R.drawable.ic_stat_cymor)
                    .setContentTitle("You have not started: " + title)
                    .setContentText("Tap to open CYMOR TO-DO and check in.")
                    .setAutoCancel(true)
                    .setContentIntent(activityIntent(6, null))
                    .build();
            if (nm != null) nm.notify(NOTIF_RING + 1, m);
        }
    }

    private void releaseMedia() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { /* not started */ }
            player.release();
            player = null;
        }
        if (vibrator != null) { vibrator.cancel(); vibrator = null; }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        if (audio != null && previousVolume >= 0) {
            try { audio.setStreamVolume(AudioManager.STREAM_ALARM, previousVolume, 0); } catch (Exception ignored) { /* DND policy */ }
        }
        previousVolume = -1;
    }

    private void stopRinging(boolean unused) {
        handler.removeCallbacks(timeout);
        releaseMedia();
        ringing = false;
        ringingTitle = "";
        ringingSource = "";
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(timeout);
        releaseMedia();
        ringing = false;
        super.onDestroy();
    }

    /** Stop whatever is ringing (safe to call when nothing is). */
    static void stop(Context c) {
        Intent i = new Intent(c, AlarmService.class);
        i.setAction(ACTION_STOP);
        c.startService(i);
    }

    static void snooze(Context c, int id, String title, String body, String source, int repeats) {
        Intent i = new Intent(c, AlarmService.class);
        i.setAction(ACTION_SNOOZE);
        i.putExtra(AlarmScheduler.X_ID, id);
        i.putExtra(AlarmScheduler.X_TITLE, title);
        i.putExtra(AlarmScheduler.X_BODY, body);
        i.putExtra(AlarmScheduler.X_SOURCE, source);
        i.putExtra(AlarmScheduler.X_REPEATS, repeats);
        c.startService(i);
    }
}
