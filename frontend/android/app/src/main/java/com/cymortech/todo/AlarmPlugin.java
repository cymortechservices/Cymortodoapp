package com.cymortech.todo;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

/** JavaScript bridge for the true alarm. Registered in MainActivity; used from src/lib/alarmNative.ts. */
@CapacitorPlugin(name = "CymorAlarm")
public class AlarmPlugin extends Plugin {
    private static AlarmPlugin current;
    private static String pendingAction = null;
    private static String pendingSource = null;

    @Override
    public void load() {
        current = this;
    }

    /** Called by MainActivity when it was opened from the alarm alert or one of its buttons. */
    static void onLaunchIntent(Context ctx, Intent intent) {
        String action = intent.getStringExtra(AlarmScheduler.X_ACTION);
        if (action == null) return;
        pendingAction = action;
        pendingSource = intent.getStringExtra(AlarmScheduler.X_SOURCE);
        if ("check-in".equals(action)) AlarmService.stop(ctx); // the app does the real check-in; silence the ring now
        if (current != null) {
            JSObject o = new JSObject();
            o.put("action", pendingAction);
            o.put("sourceId", pendingSource == null ? "" : pendingSource);
            current.notifyListeners("alarmAction", o, true);
        }
    }

    @PluginMethod
    public void setAlarms(PluginCall call) {
        JSArray list = call.getArray("alarms");
        JSONArray arr = new JSONArray();
        if (list != null) {
            for (int i = 0; i < list.length(); i++) {
                try { arr.put(list.getJSONObject(i)); } catch (Exception ignored) { /* skip a bad entry */ }
            }
        }
        AlarmScheduler.setAll(getContext(), arr);
        JSObject r = new JSObject();
        r.put("count", AlarmScheduler.load(getContext()).length());
        call.resolve(r);
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        AlarmScheduler.cancelAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        AlarmService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void snooze(PluginCall call) {
        int minutes = call.getInt("minutes", 5);
        String title = call.getString("title", "Activity");
        String source = call.getString("sourceId", "");
        int id = (source + "#snooze").hashCode() & 0x7fffffff;
        AlarmService.stop(getContext());
        AlarmScheduler.add(getContext(), AlarmScheduler.make(id, System.currentTimeMillis() + minutes * 60_000L, title, "It is time to start.", source, 2));
        call.resolve();
    }

    /** Rings in 5 seconds so the user can hear exactly what the real alarm sounds like on this phone. */
    @PluginMethod
    public void test(PluginCall call) {
        AlarmScheduler.add(getContext(), AlarmScheduler.make(990001, System.currentTimeMillis() + 5_000, "Test alarm", "This is how your activity alarm will sound.", "", 0));
        call.resolve();
    }

    @PluginMethod
    public void takeLaunchAction(PluginCall call) {
        JSObject o = new JSObject();
        o.put("action", pendingAction == null ? "" : pendingAction);
        o.put("sourceId", pendingSource == null ? "" : pendingSource);
        pendingAction = null;
        pendingSource = null;
        call.resolve(o);
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        JSObject o = new JSObject();
        o.put("ringing", AlarmService.ringing);
        o.put("ringingTitle", AlarmService.ringingTitle);
        o.put("ringingSource", AlarmService.ringingSource);
        o.put("ringingSince", AlarmService.ringingSince);
        o.put("scheduled", AlarmScheduler.load(c).length());
        o.put("notifications", NotificationManagerCompat.from(c).areNotificationsEnabled());
        boolean exact = true;
        if (Build.VERSION.SDK_INT >= 31) {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            exact = am != null && am.canScheduleExactAlarms();
        }
        o.put("exactAlarms", exact);
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        o.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        boolean fullScreen = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            fullScreen = nm != null && nm.canUseFullScreenIntent();
        }
        o.put("fullScreen", fullScreen);
        AudioManager am2 = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        int max = am2.getStreamMaxVolume(AudioManager.STREAM_ALARM);
        o.put("alarmVolume", max == 0 ? 0 : Math.round(100f * am2.getStreamVolume(AudioManager.STREAM_ALARM) / max));
        NotificationManager nm2 = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        o.put("dndBlocksAlarms", Build.VERSION.SDK_INT >= 23 && nm2 != null && nm2.getCurrentInterruptionFilter() == NotificationManager.INTERRUPTION_FILTER_NONE);
        o.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        o.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(o);
    }

    private void open(PluginCall call, Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            // fall back to the app's own settings page
            try {
                Intent s = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(s);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Could not open settings");
            }
        }
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) open(call, new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName())));
        else call.resolve();
    }

    @PluginMethod
    public void requestBatteryUnrestricted(PluginCall call) {
        open(call, new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName())));
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) open(call, new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName())));
        else call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        open(call, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())));
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        open(call, i);
    }
}
