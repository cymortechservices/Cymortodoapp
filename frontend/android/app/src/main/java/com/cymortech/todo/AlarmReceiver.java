package com.cymortech.todo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

/** Fired by AlarmManager at the exact start time; hands over to the foreground service that actually rings. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        AlarmScheduler.remove(context, intent.getIntExtra(AlarmScheduler.X_ID, 0));
        Intent svc = new Intent(context, AlarmService.class);
        svc.setAction(AlarmService.ACTION_RING);
        if (intent.getExtras() != null) svc.putExtras(intent.getExtras());
        ContextCompat.startForegroundService(context, svc);
    }
}
