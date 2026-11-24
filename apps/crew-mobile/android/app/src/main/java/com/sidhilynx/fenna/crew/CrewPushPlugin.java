package com.sidhilynx.fenna.crew;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * Notifications sealed by the computer: whether this build can get them
 * (Firebase is set up), the permission, this phone's token, and the
 * notification the person tapped. CrewMessagingService opens and shows them.
 */
@CapacitorPlugin(name = "CrewPush", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class CrewPushPlugin extends Plugin {

    static final String EXTRA_SLUG = "crewSlug";
    static final String EXTRA_WAIT = "crewWait";

    private static CrewPushPlugin instance;
    private JSObject pending;

    @Override
    public void load() {
        instance = this;
        pending = openedFrom(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        JSObject o = openedFrom(intent);
        if (o != null) notifyListeners("opened", o, true);
    }

    private static JSObject openedFrom(Intent intent) {
        if (intent == null || intent.getStringExtra(EXTRA_SLUG) == null) return null;
        JSObject o = new JSObject();
        o.put("slug", intent.getStringExtra(EXTRA_SLUG));
        o.put("id", intent.getStringExtra(EXTRA_WAIT));
        intent.removeExtra(EXTRA_SLUG);
        intent.removeExtra(EXTRA_WAIT);
        return o;
    }

    /** A new token from Firebase while the app runs. */
    static void tokenChanged(String token) {
        CrewPushPlugin p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("token", token);
        p.notifyListeners("token", o, true);
    }

    private boolean firebaseReady() {
        return !FirebaseApp.getApps(getContext()).isEmpty();
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject o = new JSObject();
        o.put("available", firebaseReady());
        call.resolve(o);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            granted(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "permissionAnswered");
    }

    @PermissionCallback
    private void permissionAnswered(PluginCall call) {
        granted(call);
    }

    private void granted(PluginCall call) {
        JSObject o = new JSObject();
        o.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(o);
    }

    @PluginMethod
    public void token(PluginCall call) {
        if (!firebaseReady()) {
            JSObject o = new JSObject();
            o.put("token", null);
            call.resolve(o);
            return;
        }
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            JSObject o = new JSObject();
            o.put("token", task.isSuccessful() ? task.getResult() : null);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void opened(PluginCall call) {
        JSObject o = pending != null ? pending : new JSObject();
        pending = null;
        if (!o.has("slug")) {
            o.put("slug", null);
            o.put("id", null);
        }
        call.resolve(o);
    }
}
