package com.cymortech.todo;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Stores the upcoming alarms on the phone and registers them with AlarmManager.setAlarmClock(), the strongest
 * scheduling call Android offers: it fires on time through Doze, needs no extra permission, and shows the alarm icon.
 * The list is also kept in SharedPreferences so BootReceiver can re-register everything after a reboot or app update.
 */
final class AlarmScheduler {
    static final String PREFS = "cymor_alarms";
    static final String KEY = "list";
    // JSON fields of one alarm: id (int), at (epoch ms), title, body, sourceId, repeats (int, how many extra rings if ignored)
    static final String X_RINGING = "cymor_ringing";
    static final String X_ACTION = "cymor_action";
    static final String X_SOURCE = "cymor_source";
    static final String X_TITLE = "cymor_title";
    static final String X_BODY = "cymor_body";
    static final String X_ID = "cymor_id";
    static final String X_REPEATS = "cymor_repeats";

    private AlarmScheduler() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized JSONArray load(Context c) {
        try {
            return new JSONArray(prefs(c).getString(KEY, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static synchronized void save(Context c, JSONArray a) {
        prefs(c).edit().putString(KEY, a.toString()).apply();
    }

    private static PendingIntent opIntent(Context c, int id, JSONObject o) {
        Intent i = new Intent(c, AlarmReceiver.class);
        i.setData(Uri.parse("cymor-alarm://" + id));
        if (o != null) {
            i.putExtra(X_ID, id);
            i.putExtra(X_TITLE, o.optString("title"));
            i.putExtra(X_BODY, o.optString("body"));
            i.putExtra(X_SOURCE, o.optString("sourceId"));
            i.putExtra(X_REPEATS, o.optInt("repeats", 2));
        }
        return PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void register(Context c, JSONObject o) {
        long at = o.optLong("at");
        if (at <= System.currentTimeMillis()) return;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent show = new Intent(c, MainActivity.class);
        show.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent showPi = PendingIntent.getActivity(c, 0, show, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        try {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, showPi), opIntent(c, o.optInt("id"), o));
        } catch (SecurityException ignored) {
            // extremely rare; the reminders from the normal notification channel still arrive
        }
    }

    private static void unregister(Context c, int id) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = opIntent(c, id, null);
        if (am != null) am.cancel(pi);
        pi.cancel();
    }

    /** Replace everything: cancel what we had, store and register the new list. */
    static synchronized void setAll(Context c, JSONArray alarms) {
        JSONArray old = load(c);
        for (int i = 0; i < old.length(); i++) unregister(c, old.optJSONObject(i) == null ? 0 : old.optJSONObject(i).optInt("id"));
        JSONArray keep = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject o = alarms.optJSONObject(i);
            if (o == null || o.optLong("at") <= now) continue;
            keep.put(o);
            register(c, o);
        }
        save(c, keep);
    }

    /** Add one alarm (snooze / repeat) without touching the others. */
    static synchronized void add(Context c, JSONObject o) {
        JSONArray cur = load(c);
        JSONArray next = new JSONArray();
        int id = o.optInt("id");
        for (int i = 0; i < cur.length(); i++) {
            JSONObject x = cur.optJSONObject(i);
            if (x != null && x.optInt("id") != id) next.put(x);
        }
        next.put(o);
        save(c, next);
        register(c, o);
    }

    /** Forget an alarm that just fired. */
    static synchronized void remove(Context c, int id) {
        JSONArray cur = load(c);
        JSONArray next = new JSONArray();
        for (int i = 0; i < cur.length(); i++) {
            JSONObject x = cur.optJSONObject(i);
            if (x != null && x.optInt("id") != id) next.put(x);
        }
        save(c, next);
    }

    static synchronized void cancelAll(Context c) {
        setAll(c, new JSONArray());
    }

    static synchronized void rescheduleAll(Context c) {
        JSONArray cur = load(c);
        long now = System.currentTimeMillis();
        JSONArray keep = new JSONArray();
        for (int i = 0; i < cur.length(); i++) {
            JSONObject o = cur.optJSONObject(i);
            if (o == null || o.optLong("at") <= now) continue;
            keep.put(o);
            register(c, o);
        }
        save(c, keep);
    }

    static JSONObject make(int id, long at, String title, String body, String sourceId, int repeats) {
        JSONObject o = new JSONObject();
        try {
            o.put("id", id).put("at", at).put("title", title).put("body", body).put("sourceId", sourceId).put("repeats", repeats);
        } catch (JSONException ignored) { /* keys are constants */ }
        return o;
    }
}
