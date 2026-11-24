package com.sidhilynx.fenna.crew;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Base64;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONObject;

/**
 * A notification from the computer: a data message holding the hub id and a
 * blob sealed with this phone's push key (packages/crew-link, pushKeyRaw).
 * Firebase and Google see neither the text nor which bot it is from. The key
 * and ids are what the app saved in Capacitor Preferences when it paired.
 */
public class CrewMessagingService extends FirebaseMessagingService {

    private static final String PREFS = "CapacitorStorage";
    private static final String CHANNEL = "needs";

    @Override
    public void onNewToken(String token) {
        CrewPushPlugin.tokenChanged(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        String hub = data.get("h");
        String sealed = data.get("d");
        if (hub == null || sealed == null) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String key = prefs.getString("crew.pushKey", null);
        String savedHub = prefs.getString("crew.hub", null);
        String phone = prefs.getString("crew.phoneId", null);
        // Not paired, or paired with another computer since: nothing to show.
        if (key == null || phone == null || !hub.equals(savedHub)) return;
        JSONObject n;
        try {
            n = new JSONObject(open(key, hub + ">" + phone, sealed));
        } catch (Exception e) {
            return;
        }
        show(n.optString("id"), n.optString("slug"), n.optString("title", "Fenna Crew"), n.optString("body"));
    }

    /** Opens "1.<nonce>.<ciphertext>" (AES-GCM, 128-bit tag, the direction as additional data). */
    static String open(String rawKey, String aad, String sealed) throws Exception {
        String[] parts = sealed.split("\\.");
        if (parts.length != 3 || !parts[0].equals("1")) throw new IllegalArgumentException("unknown format");
        int flags = Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP;
        byte[] key = Base64.decode(rawKey, flags);
        byte[] nonce = Base64.decode(parts[1], flags);
        byte[] body = Base64.decode(parts[2], flags);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(body), StandardCharsets.UTF_8);
    }

    private void show(String id, String slug, String title, String body) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, getString(R.string.channel_needs), NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription(getString(R.string.channel_needs_about));
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra(CrewPushPlugin.EXTRA_SLUG, slug);
        open.putExtra(CrewPushPlugin.EXTRA_WAIT, id);
        int code = id.hashCode();
        PendingIntent tap = PendingIntent.getActivity(this, code, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_crew)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(tap);
        try {
            NotificationManagerCompat.from(this).notify(code, b.build());
        } catch (SecurityException e) {
            // Notifications are off for the app; the Inbox shows it next time.
        }
    }
}
